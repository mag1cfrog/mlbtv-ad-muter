import type {
  DetectorInspection,
  DetectorPhase,
  DetectorRefreshMessage,
  DetectorResponse,
  DetectorStateMessage,
  DetectorStateRequest,
  ExtensionSettings,
  PlayerClassification,
  TabAudioStateMessage
} from "./shared/types.ts";
import { inspect, SELECTORS } from "./content/detector.ts";
import { confirmationDelayFor, muteRetryDelay, TIMING_MS } from "./content/timing-policy.ts";
import { removeOverlay, renderOverlay, showReloadNotice } from "./content/overlay.ts";
import type { OverlayAudioState } from "./content/overlay.ts";
import { DEFAULT_SETTINGS, getSettings } from "./shared/settings.ts";
import { normalizePosition } from "./shared/overlay-policy.ts";

const extensionVersion = chrome.runtime.getManifest().version;
let settings: ExtensionSettings = DEFAULT_SETTINGS;

let stableClassification: PlayerClassification = "unknown";
let candidateClassification: PlayerClassification | null = null;
let candidateSince = 0;
let evaluationTimer: number | null = null;
let muteRetryTimer: number | null = null;
let muteRetryAttempt = 0;
let watchdogTimer: number | null = null;
let lastMessageFingerprint = "";
let observedTarget: Element | null = null;
let observedFullscreenTarget: Element | null = null;
let latestDetectorState: DetectorStateMessage | undefined;
let monitorStopped = false;
let tabAudioState: OverlayAudioState = {
  tabMuted: false,
  manualAdOverride: false,
  muteSource: "unknown"
};

function updateOverlay(): void {
  renderOverlay({
    settings,
    detector: latestDetectorState,
    audio: tabAudioState,
    retryAttempt: muteRetryAttempt,
    version: extensionVersion
  });
}

function isMuteAcknowledgmentPending(): boolean {
  return (
    settings.enabled &&
    stableClassification === "ad" &&
    !tabAudioState.tabMuted &&
    !tabAudioState.manualAdOverride
  );
}

function clearMuteRetry(): void {
  if (muteRetryTimer !== null) {
    clearTimeout(muteRetryTimer);
    muteRetryTimer = null;
  }
  muteRetryAttempt = 0;
}

function scheduleMuteRetry(): void {
  if (
    monitorStopped ||
    muteRetryTimer !== null ||
    !isMuteAcknowledgmentPending()
  ) {
    return;
  }

  const delayMs = muteRetryDelay(muteRetryAttempt);
  muteRetryTimer = setTimeout(() => {
    muteRetryTimer = null;
    muteRetryAttempt += 1;
    lastMessageFingerprint = "";
    evaluatePlayer();
  }, delayMs);
}

function reconcileMuteRetry(): void {
  if (isMuteAcknowledgmentPending()) {
    scheduleMuteRetry();
    return;
  }

  clearMuteRetry();
}

function scheduleEvaluation(
  delayMs: number = TIMING_MS.debounce
): void {
  if (monitorStopped) {
    return;
  }

  if (evaluationTimer !== null) {
    clearTimeout(evaluationTimer);
  }

  evaluationTimer = setTimeout(() => {
    evaluationTimer = null;
    evaluatePlayer();
  }, delayMs);
}

function stopForInvalidatedContext(): void {
  if (monitorStopped) {
    return;
  }

  monitorStopped = true;
  if (evaluationTimer !== null) {
    clearTimeout(evaluationTimer);
    evaluationTimer = null;
  }
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  clearMuteRetry();
  observer.disconnect();
  fullscreenObserver.disconnect();

  if (settings.showOverlay) {
    showReloadNotice(settings.overlayPosition, extensionVersion);
  } else {
    removeOverlay();
  }
}

function handleRuntimeFailure(error: unknown): void {
  const message = error instanceof Error
    ? error.message
    : String(error || "");

  if (message.includes("Extension context invalidated")) {
    stopForInvalidatedContext();
    return;
  }

  lastMessageFingerprint = "";
  scheduleMuteRetry();
}

function findPlayer(): Element | null {
  return (
    document.querySelector(SELECTORS.player) ||
    document.querySelector(SELECTORS.fallbackPlayer)
  );
}

function refreshObserverTarget(): void {
  const player = findPlayer();
  const nextTarget =
    player?.closest(".mlbtv-player") ||
    player ||
    document.documentElement;

  if (nextTarget !== observedTarget) {
    observer.disconnect();
    observer.observe(nextTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label", "class"]
    });
    observedTarget = nextTarget;
  }

  const nextFullscreenTarget =
    player?.closest(".mlbtv-player") || null;

  if (nextFullscreenTarget === observedFullscreenTarget) {
    return;
  }

  fullscreenObserver.disconnect();
  if (nextFullscreenTarget) {
    fullscreenObserver.observe(nextFullscreenTarget, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }
  observedFullscreenTarget = nextFullscreenTarget;
}

function publishDetectorState(
  inspection: DetectorInspection,
  phase: DetectorPhase
): void {
  const payload: DetectorStateMessage = {
    type: "detector-state",
    phase,
    stableClassification,
    rawClassification: inspection.classification,
    confidence: inspection.confidence,
    reason: inspection.reason,
    signals: inspection.signals
  };
  const fingerprint = JSON.stringify(payload);
  latestDetectorState = payload;
  updateOverlay();
  reconcileMuteRetry();

  if (fingerprint === lastMessageFingerprint) {
    return;
  }

  lastMessageFingerprint = fingerprint;
  try {
    chrome.runtime
      .sendMessage(payload)
      .then((response: unknown) => {
        const message = response as DetectorResponse;
        if (message?.type === "tab-audio-state") {
          applyTabAudioState(message);
        } else if (message?.type === "detector-error") {
          handleRuntimeFailure(message.error);
        }
      })
      .catch(handleRuntimeFailure);
  } catch (error) {
    handleRuntimeFailure(error);
  }
}

function applyTabAudioState(message: TabAudioStateMessage): void {
  settings = { ...settings, enabled: message.enabled === true };
  tabAudioState = {
    tabMuted: message.tabMuted === true,
    manualAdOverride: message.manualAdOverride === true,
    muteSource: message.muteSource || "unknown"
  };
  reconcileMuteRetry();
  updateOverlay();
}

function evaluatePlayer(): void {
  if (monitorStopped) {
    return;
  }

  refreshObserverTarget();
  const inspection = inspect(document);
  const nextClassification = inspection.classification;
  const now = Date.now();

  if (nextClassification !== candidateClassification) {
    candidateClassification = nextClassification;
    candidateSince = now;
  }

  const holdMs = confirmationDelayFor(inspection);
  const elapsedMs = now - candidateSince;

  if (
    nextClassification !== stableClassification &&
    elapsedMs >= holdMs
  ) {
    stableClassification = nextClassification;
    publishDetectorState(inspection, "stable");
    return;
  }

  if (nextClassification !== stableClassification) {
    publishDetectorState(inspection, "candidate");
    scheduleEvaluation(Math.max(holdMs - elapsedMs, 50));
    return;
  }

  publishDetectorState(inspection, "stable");
}

const observer = new MutationObserver(() => {
  const explicitAdMarkerPresent =
    stableClassification !== "ad" &&
    Boolean(
      findPlayer()?.querySelector(SELECTORS.adControls)
    );

  scheduleEvaluation(
    explicitAdMarkerPresent
      ? 0
      : TIMING_MS.debounce
  );
});
const fullscreenObserver = new MutationObserver(() => {
  if (!settings.showOverlay) {
    return;
  }

  updateOverlay();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  let shouldEvaluate = false;

  if (changes.enabled) {
    settings = { ...settings, enabled: changes.enabled.newValue === true };
    lastMessageFingerprint = "";
    shouldEvaluate = true;
  }

  if (changes.showOverlay) {
    settings = { ...settings, showOverlay: changes.showOverlay.newValue === true };
    shouldEvaluate = true;
  }

  if (changes.overlayPosition) {
    settings = {
      ...settings,
      overlayPosition: normalizePosition(changes.overlayPosition.newValue)
    };
    updateOverlay();
  }

  if (shouldEvaluate) {
    evaluatePlayer();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const runtimeMessage = message as
    | DetectorRefreshMessage
    | DetectorStateRequest
    | TabAudioStateMessage;

  if (runtimeMessage?.type === "get-detector-state") {
    sendResponse(latestDetectorState);
    return false;
  }

  if (runtimeMessage?.type === "refresh-detector-state") {
    lastMessageFingerprint = "";
    evaluatePlayer();
    return false;
  }

  if (runtimeMessage?.type !== "tab-audio-state") {
    return false;
  }

  applyTabAudioState(runtimeMessage);
  return false;
});

function handleFullscreenChange(): void {
  if (!settings.showOverlay) {
    return;
  }

  updateOverlay();
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener(
  "webkitfullscreenchange",
  handleFullscreenChange
);

getSettings()
  .then((storedSettings) => {
    settings = storedSettings;
    updateOverlay();
  })
  .catch(handleRuntimeFailure);

watchdogTimer = setInterval(
  evaluatePlayer,
  TIMING_MS.watchdog
);
evaluatePlayer();
