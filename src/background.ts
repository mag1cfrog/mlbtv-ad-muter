"use strict";

importScripts("mute-policy.js", "overlay-policy.js");

const extensionGlobals = globalThis as ExtensionGlobals;
const mutePolicy = extensionGlobals.MlbTvAdMuterMutePolicy;
const overlayPolicy = extensionGlobals.MlbTvAdMuterOverlayPolicy;

if (!mutePolicy || !overlayPolicy) {
  throw new Error("Ad Muter for MLB.TV: background dependencies failed to load.");
}

const activeMutePolicy: MutePolicy = mutePolicy;
const activeOverlayPolicy: OverlayPolicy = overlayPolicy;

const SETTINGS_DEFAULTS: ExtensionSettings = Object.freeze({
  enabled: false,
  showOverlay: false,
  overlayPosition: activeOverlayPolicy.DEFAULT_POSITION
});
const DEBUG_HISTORY_LIMIT = 40;
const tabTaskQueues = new Map<number, Promise<unknown>>();

function sessionKey(tabId: number): string {
  return `tab:${tabId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function getSessionRecord(tabId: number): Promise<TabSessionRecord> {
  const key = sessionKey(tabId);
  const values = await chrome.storage.session.get(key);
  return values[key] as TabSessionRecord | undefined || {};
}

async function setSessionRecord(
  tabId: number,
  record: TabSessionRecord
): Promise<void> {
  await chrome.storage.session.set({
    [sessionKey(tabId)]: record
  });
}

async function getTabMuteState(
  tabId: number
): Promise<Pick<TabSessionRecord, "tabMuted" | "muteSource">> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      tabMuted: Boolean(tab.mutedInfo?.muted),
      muteSource: activeMutePolicy.classifyMuteSource(
        tab.mutedInfo,
        chrome.runtime.id
      )
    };
  } catch {
    return {
      tabMuted: null,
      muteSource: "unavailable"
    };
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

async function ensureMuted(
  tabId: number,
  record: TabSessionRecord
): Promise<TabSessionRecord> {
  const tab = await chrome.tabs.get(tabId);
  const actualState = activeMutePolicy.describeTabMuteState(
    tab.mutedInfo,
    chrome.runtime.id
  );

  if (actualState.tabMuted) {
    return {
      ...record,
      ...actualState
    };
  }

  await chrome.tabs.update(tabId, { muted: true });
  return {
    ...record,
    mutedByExtension: true
  };
}

async function releaseMute(
  tabId: number,
  record: TabSessionRecord
): Promise<TabSessionRecord> {
  if (!record.mutedByExtension) {
    return {
      ...record,
      mutedByExtension: false
    };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const mutedByThisExtension =
      tab.mutedInfo?.muted &&
      tab.mutedInfo.reason === "extension" &&
      tab.mutedInfo.extensionId === chrome.runtime.id;

    if (mutedByThisExtension) {
      await chrome.tabs.update(tabId, { muted: false });
    }
  } catch {
    // The tab may have closed between the state transition and this check.
  }

  return {
    ...record,
    mutedByExtension: false
  };
}

function appendDebugEvent(
  record: TabSessionRecord,
  event: DebugEvent
): DebugEvent[] {
  const history = Array.isArray(record.debugHistory)
    ? record.debugHistory
    : [];

  return [
    ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
    event
  ];
}

function addDetectorDebugEvent(
  previous: TabSessionRecord,
  record: TabSessionRecord,
  message: DetectorStateMessage,
  decision: MuteDecision
): TabSessionRecord {
  const event: DetectorDebugEvent = {
    eventType: "detector-state",
    at: Date.now(),
    phase: message.phase,
    rawClassification: message.rawClassification,
    stableClassification: message.stableClassification,
    reason: message.reason,
    decision: decision.action,
    decisionReason: decision.reason,
    mutedByExtension: Boolean(record.mutedByExtension),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource,
    signals: message.signals
  };

  console.debug("Ad Muter for MLB.TV transition", event);

  return {
    ...record,
    lastDecision: decision.action,
    debugHistory: appendDebugEvent(previous, event)
  };
}

function addMuteDebugEvent(
  record: TabSessionRecord,
  mutedInfo: chrome.tabs.MutedInfo
): TabSessionRecord {
  const muteSource = activeMutePolicy.classifyMuteSource(
    mutedInfo,
    chrome.runtime.id
  );
  const event: MuteChangeDebugEvent = {
    eventType: "tab-mute-change",
    at: Date.now(),
    tabMuted: Boolean(mutedInfo.muted),
    muteSource,
    stableClassification: record.stableClassification || "unknown"
  };

  console.debug("Ad Muter for MLB.TV tab audio change", event);

  return {
    ...record,
    tabMuted: event.tabMuted,
    muteSource,
    mutedByExtension:
      muteSource === "this-extension" && event.tabMuted,
    manualAdOverride:
      !event.tabMuted &&
      muteSource !== "this-extension" &&
      record.stableClassification === "ad"
        ? true
        : Boolean(record.manualAdOverride),
    updatedAt: event.at,
    debugHistory: appendDebugEvent(record, event)
  };
}

function addReconciliationDebugEvent(
  record: TabSessionRecord
): TabSessionRecord {
  const event: ReconciliationDebugEvent = {
    eventType: "mute-reconciliation",
    at: Date.now(),
    stableClassification: record.stableClassification,
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Ad Muter for MLB.TV repaired tab audio state", event);

  return {
    ...record,
    debugHistory: appendDebugEvent(record, event)
  };
}

function addNavigationDebugEvent(
  record: TabSessionRecord,
  decision: NavigationDecision
): TabSessionRecord {
  const event: NavigationDebugEvent = {
    eventType: "navigation",
    at: Date.now(),
    decision,
    adMuteLatched: Boolean(record.adMuteLatched),
    mutedByExtension: Boolean(record.mutedByExtension),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Ad Muter for MLB.TV navigation audio policy", event);

  return {
    ...record,
    lastDecision: decision,
    debugHistory: appendDebugEvent(record, event)
  };
}

async function handleDetectorState(
  tabId: number,
  message: DetectorStateMessage
): Promise<TabAudioStateMessage> {
  const settings = await chrome.storage.local.get(
    SETTINGS_DEFAULTS
  ) as ExtensionSettings;
  const previous = await getSessionRecord(tabId);
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

  const decision = activeMutePolicy.decideMuteAction({
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
  next = addDetectorDebugEvent(previous, next, message, decision);
  await setSessionRecord(tabId, next);
  await setBadge(tabId, next, settings.enabled);
  await notifyTabAudioState(tabId, next, settings.enabled);
  return createTabAudioStateMessage(next, settings.enabled);
}

function queueTabTask<T>(
  tabId: number,
  task: () => Promise<T>
): Promise<T> {
  const previousTask = tabTaskQueues.get(tabId) || Promise.resolve();
  const nextTask = previousTask
    .catch(() => {})
    .then(task);

  tabTaskQueues.set(tabId, nextTask);
  const cleanUpQueue = () => {
    if (tabTaskQueues.get(tabId) === nextTask) {
      tabTaskQueues.delete(tabId);
    }
  };
  nextTask.then(cleanUpQueue, cleanUpQueue);

  return nextTask;
}

function queueDetectorState(
  tabId: number,
  message: DetectorStateMessage
): Promise<TabAudioStateMessage> {
  return queueTabTask(
    tabId,
    () => handleDetectorState(tabId, message)
  );
}

async function handleMuteInfoChange(
  tabId: number,
  mutedInfo: chrome.tabs.MutedInfo
): Promise<void> {
  const settings = await chrome.storage.local.get(
    SETTINGS_DEFAULTS
  ) as ExtensionSettings;
  const previous = await getSessionRecord(tabId);
  let next = addMuteDebugEvent(previous, mutedInfo);
  const shouldRepairUnmute = activeMutePolicy.shouldRepairUnmute({
    enabled: settings.enabled,
    manualAdOverride: Boolean(next.manualAdOverride),
    muteSource: next.muteSource || "unknown",
    stableClassification: next.stableClassification,
    tabMuted: next.tabMuted === true
  });

  if (shouldRepairUnmute) {
    next = await ensureMuted(tabId, next);
    next = {
      ...next,
      ...(await getTabMuteState(tabId))
    };
    next = addReconciliationDebugEvent(next);
  }

  await setSessionRecord(tabId, next);
  await setBadge(tabId, next, settings.enabled);
  await notifyTabAudioState(tabId, next, settings.enabled);
}

async function handleNavigation(
  tabId: number,
  navigationUrl?: string
): Promise<void> {
  const settings = await chrome.storage.local.get(
    SETTINGS_DEFAULTS
  ) as ExtensionSettings;
  const previous = await getSessionRecord(tabId);
  let currentUrl = navigationUrl;

  if (!currentUrl) {
    try {
      currentUrl = (await chrome.tabs.get(tabId)).url;
    } catch {
      currentUrl = "";
    }
  }

  const preserveAdMute = activeMutePolicy.shouldPreserveAdMuteOnNavigation({
    adMuteLatched: Boolean(previous.adMuteLatched),
    enabled: settings.enabled,
    isSupportedStream: isSupportedStreamUrl(currentUrl || ""),
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
  next = addNavigationDebugEvent(
    next,
    preserveAdMute ? "preserve-ad-mute" : "release-navigation-mute"
  );

  await setSessionRecord(tabId, next);
  await setBadge(tabId, next, settings.enabled);
  await notifyTabAudioState(tabId, next, settings.enabled);
}

async function releaseAllExtensionMutes(): Promise<void> {
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
      const record = await getSessionRecord(tabId);
      let next = await releaseMute(tabId, record);
      next = {
        ...next,
        adMuteLatched: false,
        ...(await getTabMuteState(tabId))
      };
      await setSessionRecord(tabId, next);
      await setBadge(tabId, next, false);
      await notifyTabAudioState(tabId, next, false);
    }));
  }

  await Promise.all(
    releaseTasks.map((release) => release.catch(console.error))
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(
    Object.keys(SETTINGS_DEFAULTS)
  );
  const missingDefaults: Record<string, boolean | OverlayPosition> = {};

  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    if (typeof existing[key] !== typeof value) {
      missingDefaults[key] = value;
    }
  }

  const normalizedOverlayPosition = activeOverlayPolicy.normalizePosition(
    existing.overlayPosition
  );
  if (existing.overlayPosition !== normalizedOverlayPosition) {
    missingDefaults.overlayPosition = normalizedOverlayPosition;
  }

  if (Object.keys(missingDefaults).length) {
    await chrome.storage.local.set(missingDefaults);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const runtimeMessage = message as DetectorStateMessage | PopupStateRequest;
  const senderTabId = sender.tab?.id;

  if (
    runtimeMessage?.type === "detector-state" &&
    typeof senderTabId === "number"
  ) {
    queueDetectorState(senderTabId, runtimeMessage)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error(error);
        sendResponse({
          type: "detector-error",
          error: errorMessage(error)
        } satisfies DetectorErrorMessage);
      });
    return true;
  }

  if (
    runtimeMessage?.type === "get-popup-state" &&
    Number.isInteger(runtimeMessage.tabId)
  ) {
    Promise.all([
      chrome.storage.local.get(SETTINGS_DEFAULTS),
      getSessionRecord(runtimeMessage.tabId)
    ])
      .then(([settings, record]) => {
        const storedSettings = settings as ExtensionSettings;
        sendResponse({
          enabled: storedSettings.enabled,
          showOverlay: storedSettings.showOverlay,
          overlayPosition: activeOverlayPolicy.normalizePosition(
            storedSettings.overlayPosition
          ),
          record
        } satisfies PopupStateResponse);
      })
      .catch((error: unknown) => {
        sendResponse({
          error: errorMessage(error)
        } satisfies PopupErrorResponse);
      });
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    changes.enabled &&
    changes.enabled.newValue === false
  ) {
    releaseAllExtensionMutes().catch(console.error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const mutedInfo = changeInfo.mutedInfo;

  if (mutedInfo) {
    queueTabTask(
      tabId,
      () => handleMuteInfoChange(tabId, mutedInfo)
    ).catch(console.error);
  }

  if (changeInfo.status === "loading") {
    queueTabTask(
      tabId,
      () => handleNavigation(tabId, changeInfo.url)
    ).catch(() => {
      // A missing or inaccessible tab needs no cleanup.
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueTabTask(
    tabId,
    () => chrome.storage.session.remove(sessionKey(tabId))
  ).catch(() => {});
});
