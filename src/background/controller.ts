import type {
  DetectorRefreshMessage,
  DetectorStateMessage,
  TabAudioStateMessage,
  TabSessionRecord
} from "../shared/types.ts";
import { getSettings } from "../shared/settings.ts";
import { getTabRecord, sessionKey, setTabRecord } from "../shared/tab-session.ts";
import {
  decideMuteAction,
  shouldPreserveAdMuteOnNavigation,
  shouldRepairUnmute
} from "./mute-policy.ts";
import { ensureMuted, getTabMuteState, releaseMute, RELEASE_RETRY_PREFIX } from "./tab-audio.ts";
import {
  recordDetection,
  recordMuteChange,
  recordMuteRepair,
  recordNavigation
} from "./tab-state.ts";
import { queueTabTask } from "./tab-queue.ts";

export async function handleDetectorState(
  tabId: number,
  message: DetectorStateMessage
): Promise<TabAudioStateMessage> {
  const settings = await getSettings();
  const previous = await getTabRecord(tabId);
  let next: TabSessionRecord = {
    ...previous,
    phase: message.phase,
    stableClassification: message.stableClassification,
    rawClassification: message.rawClassification,
    confidence: message.confidence,
    reason: message.reason,
    signals: message.signals,
    updatedAt: Date.now()
  };

  if (
    message.phase === "stable" &&
    message.stableClassification === "content"
  ) {
    next.manualAdOverride = false;
    next.adMuteLatched = false;
  } else if (message.stableClassification === "ad") {
    next.adMuteLatched = true;
  }

  const decision = decideMuteAction({
    enabled: settings.enabled,
    manualAdOverride: Boolean(next.manualAdOverride),
    phase: message.phase,
    stableClassification: message.stableClassification
  });

  if (decision.action === "ensure-muted") {
    next = await ensureMuted(tabId, next);
  } else if (decision.action === "release") {
    next = await releaseMute(tabId, next);
  }

  next = {
    ...next,
    ...(await getTabMuteState(tabId))
  };
  next = recordDetection(previous, next, message, decision);
  await publishTabState(tabId, next, settings.enabled);
  return createTabAudioStateMessage(next, settings.enabled);
}

export async function handleMuteInfoChange(
  tabId: number,
  mutedInfo: chrome.tabs.MutedInfo
): Promise<void> {
  const settings = await getSettings();
  const previous = await getTabRecord(tabId);
  let next = recordMuteChange(previous, mutedInfo, chrome.runtime.id);
  const needsMuteRepair = shouldRepairUnmute({
    enabled: settings.enabled,
    manualAdOverride: Boolean(next.manualAdOverride),
    muteSource: next.muteSource || "unknown",
    stableClassification: next.stableClassification,
    tabMuted: next.tabMuted === true
  });

  if (needsMuteRepair) {
    next = await ensureMuted(tabId, next);
    next = {
      ...next,
      ...(await getTabMuteState(tabId))
    };
    next = recordMuteRepair(next);
  }

  await publishTabState(tabId, next, settings.enabled);
}

export async function handleNavigation(
  tabId: number,
  navigationUrl?: string
): Promise<void> {
  const settings = await getSettings();
  const previous = await getTabRecord(tabId);
  let currentUrl = navigationUrl;

  if (!currentUrl) {
    try {
      currentUrl = (await chrome.tabs.get(tabId)).url;
    } catch {
      currentUrl = "";
    }
  }

  const isSupportedStream = isSupportedStreamUrl(currentUrl || "");
  const preserveAdMute = shouldPreserveAdMuteOnNavigation({
    adMuteLatched: Boolean(previous.adMuteLatched),
    enabled: settings.enabled,
    isSupportedStream,
    manualAdOverride: Boolean(previous.manualAdOverride),
    stableClassification: previous.stableClassification
  });
  let next = preserveAdMute
    ? await ensureMuted(tabId, previous)
    : await releaseMute(tabId, previous);
  next = {
    ...next,
    phase: "stable",
    stableClassification: "unknown",
    rawClassification: "unknown",
    reason: "navigation",
    adMuteLatched: preserveAdMute,
    manualAdOverride: preserveAdMute
      ? Boolean(previous.manualAdOverride)
      : false,
    ...(await getTabMuteState(tabId))
  };
  next = recordNavigation(
    next,
    preserveAdMute ? "preserve-ad-mute" : "release-navigation-mute"
  );

  await publishTabState(tabId, next, settings.enabled);
  if (isSupportedStream) {
    await requestDetectorState(tabId);
  }
}

export async function releaseAllExtensionMutes(): Promise<void> {
  const allSessionValues = await chrome.storage.session.get();
  const releaseTasks: Promise<void>[] = [];

  for (const key of Object.keys(allSessionValues)) {
    if (!key.startsWith("tab:")) {
      continue;
    }

    const tabId = Number(key.slice(4));
    if (!Number.isInteger(tabId)) {
      continue;
    }

    releaseTasks.push(queueTabTask(tabId, async () => {
      const record = await getTabRecord(tabId);
      let next = await releaseMute(tabId, record);
      next = {
        ...next,
        adMuteLatched: false,
        ...(await getTabMuteState(tabId))
      };
      await publishTabState(tabId, next, false);
    }));
  }

  await Promise.all(
    releaseTasks.map((release) => release.catch(console.error))
  );
}

export async function retryMuteRelease(tabId: number): Promise<void> {
  const record = await getTabRecord(tabId);
  const alarmName = `${RELEASE_RETRY_PREFIX}${tabId}`;
  if (!record.mutedByExtension) {
    await chrome.alarms.clear(alarmName);
    return;
  }

  // Query confirms a closed tab without mistaking a failed lookup for closure.
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    await chrome.storage.session.remove(sessionKey(tabId));
    await chrome.alarms.clear(alarmName);
    return;
  }

  const settings = await getSettings();
  if (settings.enabled && isSupportedStreamUrl(tab.url || "")) {
    // A new stream may be playing an ad. Ask its detector before releasing.
    await requestDetectorState(tabId);
    return;
  }

  await handleNavigation(tabId, tab.url);
}

async function publishTabState(
  tabId: number,
  record: TabSessionRecord,
  enabled: boolean
): Promise<void> {
  await setTabRecord(tabId, record);
  await setBadge(tabId, record, enabled);
  await notifyTabAudioState(tabId, record, enabled);
}

function isSupportedStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "www.mlb.com" &&
      parsed.pathname.startsWith("/tv/")
    );
  } catch {
    return false;
  }
}

function createTabAudioStateMessage(
  record: TabSessionRecord,
  enabled: boolean
): TabAudioStateMessage {
  return {
    type: "tab-audio-state",
    enabled,
    tabMuted: record.tabMuted,
    manualAdOverride: Boolean(record.manualAdOverride),
    muteSource: record.muteSource || "unknown"
  };
}

async function notifyTabAudioState(
  tabId: number,
  record: TabSessionRecord,
  enabled: boolean
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      createTabAudioStateMessage(record, enabled)
    );
  } catch {
    // The content script may not be available during navigation.
  }
}

async function requestDetectorState(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: "refresh-detector-state" } satisfies DetectorRefreshMessage
    );
  } catch {
    // A new content script will publish its initial state after navigation.
  }
}

async function setBadge(
  tabId: number,
  record: TabSessionRecord,
  enabled: boolean
): Promise<void> {
  let text = "";
  let color = "#64748b";

  if (record.phase === "candidate") {
    text = "?";
  } else if (record.stableClassification === "ad") {
    text = "AD";
    color = enabled ? "#b45309" : "#64748b";
  } else if (record.stableClassification === "content" && enabled) {
    text = "ON";
    color = "#15803d";
  }

  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
}
