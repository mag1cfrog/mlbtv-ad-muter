"use strict";

importScripts("mute-policy.js", "overlay-policy.js");

const mutePolicy = globalThis.BaseballBreakMutePolicy;
const overlayPolicy = globalThis.BaseballBreakOverlayPolicy;

if (!mutePolicy || !overlayPolicy) {
  throw new Error("Baseball Break Muter: background dependencies failed to load.");
}

const SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  showOverlay: false,
  overlayPosition: overlayPolicy.DEFAULT_POSITION
});
const DEBUG_HISTORY_LIMIT = 40;
const detectorQueues = new Map();

function sessionKey(tabId) {
  return `tab:${tabId}`;
}

function isSupportedStreamUrl(url) {
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

async function getSessionRecord(tabId) {
  const key = sessionKey(tabId);
  const values = await chrome.storage.session.get(key);
  return values[key] || {};
}

async function setSessionRecord(tabId, record) {
  await chrome.storage.session.set({
    [sessionKey(tabId)]: record
  });
}

async function getTabMuteState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      tabMuted: Boolean(tab.mutedInfo?.muted),
      muteSource: mutePolicy.classifyMuteSource(
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

function createTabAudioStateMessage(record, enabled) {
  return {
    type: "tab-audio-state",
    enabled,
    tabMuted: record.tabMuted,
    mutedByExtension: Boolean(record.mutedByExtension),
    manualAdOverride: Boolean(record.manualAdOverride),
    muteSource: record.muteSource || "unknown"
  };
}

async function notifyTabAudioState(tabId, record, enabled) {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      createTabAudioStateMessage(record, enabled)
    );
  } catch {
    // The content script may not be available during navigation.
  }
}

async function setBadge(tabId, record, enabled) {
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

async function ensureMuted(tabId, record) {
  const tab = await chrome.tabs.get(tabId);
  const actualState = mutePolicy.describeTabMuteState(
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
    mutedByExtension: true,
    wasMutedBeforeAd: false
  };
}

async function releaseMute(tabId, record) {
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
    mutedByExtension: false,
    wasMutedBeforeAd: false
  };
}

function addDebugEvent(previous, record, message, decision) {
  const history = Array.isArray(previous.debugHistory)
    ? previous.debugHistory
    : [];
  const event = {
    eventType: "detector-state",
    at: Date.now(),
    phase: message.phase,
    rawClassification: message.rawClassification,
    stableClassification: message.stableClassification,
    reason: message.reason,
    decision: decision.action,
    decisionReason: decision.reason,
    mutedByExtension: Boolean(record.mutedByExtension),
    wasMutedBeforeAd: Boolean(record.wasMutedBeforeAd),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource,
    signals: message.signals
  };

  console.debug("Baseball Break Muter transition", event);

  return {
    ...record,
    lastDecision: decision.action,
    debugHistory: [
      ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
      event
    ]
  };
}

function addMuteDebugEvent(record, mutedInfo) {
  const history = Array.isArray(record.debugHistory)
    ? record.debugHistory
    : [];
  const muteSource = mutePolicy.classifyMuteSource(
    mutedInfo,
    chrome.runtime.id
  );
  const event = {
    eventType: "tab-mute-change",
    at: Date.now(),
    tabMuted: Boolean(mutedInfo.muted),
    muteSource,
    stableClassification: record.stableClassification || "unknown"
  };

  console.debug("Baseball Break Muter tab audio change", event);

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
    debugHistory: [
      ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
      event
    ]
  };
}

function addReconciliationDebugEvent(record) {
  const history = Array.isArray(record.debugHistory)
    ? record.debugHistory
    : [];
  const event = {
    eventType: "mute-reconciliation",
    at: Date.now(),
    stableClassification: record.stableClassification,
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Baseball Break Muter repaired tab audio state", event);

  return {
    ...record,
    debugHistory: [
      ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
      event
    ]
  };
}

function addNavigationDebugEvent(record, decision) {
  const history = Array.isArray(record.debugHistory)
    ? record.debugHistory
    : [];
  const event = {
    eventType: "navigation",
    at: Date.now(),
    decision,
    adMuteLatched: Boolean(record.adMuteLatched),
    mutedByExtension: Boolean(record.mutedByExtension),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Baseball Break Muter navigation audio policy", event);

  return {
    ...record,
    lastDecision: decision,
    debugHistory: [
      ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
      event
    ]
  };
}

async function handleDetectorState(tabId, message) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const previous = await getSessionRecord(tabId);
  let next = {
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

  const decision = mutePolicy.decideMuteAction({
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
  next = addDebugEvent(previous, next, message, decision);
  await setSessionRecord(tabId, next);
  await setBadge(tabId, next, settings.enabled);
  await notifyTabAudioState(tabId, next, settings.enabled);
  return createTabAudioStateMessage(next, settings.enabled);
}

function queueTabTask(tabId, task) {
  const previousTask = detectorQueues.get(tabId) || Promise.resolve();
  const nextTask = previousTask
    .catch(() => {})
    .then(task);

  detectorQueues.set(tabId, nextTask);
  const cleanUpQueue = () => {
    if (detectorQueues.get(tabId) === nextTask) {
      detectorQueues.delete(tabId);
    }
  };
  nextTask.then(cleanUpQueue, cleanUpQueue);

  return nextTask;
}

function queueDetectorState(tabId, message) {
  return queueTabTask(
    tabId,
    () => handleDetectorState(tabId, message)
  );
}

async function handleMuteInfoChange(tabId, mutedInfo) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const previous = await getSessionRecord(tabId);
  let next = addMuteDebugEvent(previous, mutedInfo);
  const shouldRepairUnmute = mutePolicy.shouldRepairUnmute({
    enabled: settings.enabled,
    manualAdOverride: Boolean(next.manualAdOverride),
    muteSource: next.muteSource,
    stableClassification: next.stableClassification,
    tabMuted: next.tabMuted
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

async function handleNavigation(tabId, navigationUrl) {
  const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const previous = await getSessionRecord(tabId);
  let currentUrl = navigationUrl;

  if (!currentUrl) {
    try {
      currentUrl = (await chrome.tabs.get(tabId)).url;
    } catch {
      currentUrl = "";
    }
  }

  const preserveAdMute = mutePolicy.shouldPreserveAdMuteOnNavigation({
    adMuteLatched: Boolean(previous.adMuteLatched),
    enabled: settings.enabled,
    isSupportedStream: isSupportedStreamUrl(currentUrl),
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

async function releaseAllExtensionMutes() {
  const allSessionValues = await chrome.storage.session.get(null);

  for (const [key, record] of Object.entries(allSessionValues)) {
    if (!key.startsWith("tab:")) {
      continue;
    }

    const tabId = Number(key.slice(4));
    if (!Number.isInteger(tabId)) {
      continue;
    }

    let next = await releaseMute(tabId, record);
    next = {
      ...next,
      adMuteLatched: false,
      ...(await getTabMuteState(tabId))
    };
    await setSessionRecord(tabId, next);
    await setBadge(tabId, next, false);
    await notifyTabAudioState(tabId, next, false);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(
    Object.keys(SETTINGS_DEFAULTS)
  );
  const missingDefaults = {};

  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    if (typeof existing[key] !== typeof value) {
      missingDefaults[key] = value;
    }
  }

  const normalizedOverlayPosition = overlayPolicy.normalizePosition(
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
  if (message?.type === "detector-state" && sender.tab?.id) {
    queueDetectorState(sender.tab.id, message)
      .then(sendResponse)
      .catch((error) => {
        console.error(error);
        sendResponse({
          type: "detector-error",
          error: error.message
        });
      });
    return true;
  }

  if (message?.type === "get-popup-state" && Number.isInteger(message.tabId)) {
    Promise.all([
      chrome.storage.local.get(SETTINGS_DEFAULTS),
      getSessionRecord(message.tabId)
    ])
      .then(([settings, record]) => {
        sendResponse({
          enabled: settings.enabled,
          showOverlay: settings.showOverlay,
          overlayPosition: overlayPolicy.normalizePosition(
            settings.overlayPosition
          ),
          record
        });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
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
  if (changeInfo.mutedInfo) {
    queueTabTask(
      tabId,
      () => handleMuteInfoChange(tabId, changeInfo.mutedInfo)
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
  detectorQueues.delete(tabId);
  chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
});
