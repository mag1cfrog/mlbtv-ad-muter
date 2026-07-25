type OverlayElements = Readonly<{
  status: HTMLDivElement;
  label: HTMLElement;
  details: HTMLElement;
}>;

type ContentTabAudioState = {
  tabMuted: boolean;
  mutedByExtension: boolean;
  manualAdOverride: boolean;
  muteSource: MuteSource;
};

(function startContentMonitor() {
  "use strict";

  const extensionGlobals = globalThis as ExtensionGlobals;
  const detector = extensionGlobals.BaseballBreakDetector;
  const overlayPolicy = extensionGlobals.BaseballBreakOverlayPolicy;
  const timingPolicy = extensionGlobals.BaseballBreakTimingPolicy;
  const extensionVersion = chrome.runtime.getManifest().version;

  if (!detector || !overlayPolicy || !timingPolicy) {
    console.error("Baseball Break Muter: detector dependencies failed to load.");
    return;
  }

  const activeDetector: DetectorPolicy = detector;
  const activeOverlayPolicy: OverlayPolicy = overlayPolicy;
  const activeTimingPolicy: TimingPolicy = timingPolicy;

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
  let overlayEnabled = false;
  let overlayPosition: OverlayPosition = activeOverlayPolicy.DEFAULT_POSITION;
  let autoMuteEnabled = false;
  let overlayHost: HTMLDivElement | null = null;
  let overlayElements: OverlayElements | null = null;
  let latestInspection: DetectorInspection | null = null;
  let latestPhase: DetectorPhase = "stable";
  let monitorStopped = false;
  let tabAudioState: ContentTabAudioState = {
    tabMuted: false,
    mutedByExtension: false,
    manualAdOverride: false,
    muteSource: "unknown"
  };

  function isMuteAcknowledgmentPending(): boolean {
    return (
      autoMuteEnabled &&
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

    const delayMs = activeTimingPolicy.muteRetryDelay(muteRetryAttempt);
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
    delayMs = activeTimingPolicy.TIMING_MS.debounce
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

  function ensureOverlay(): OverlayElements {
    const mountTarget = activeOverlayPolicy.getMountTarget(document);
    const position = activeOverlayPolicy.normalizePosition(overlayPosition);

    if (overlayHost?.isConnected && overlayElements) {
      overlayHost.dataset.position = position;
      if (overlayHost.parentNode !== mountTarget) {
        mountTarget.appendChild(overlayHost);
      }
      return overlayElements;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = "baseball-break-muter-overlay-host";
    overlayHost.dataset.position = position;
    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
        }

        :host([data-position="top-left"]) {
          top: 16px;
          left: 16px;
        }

        :host([data-position="top-right"]) {
          top: 16px;
          right: 16px;
        }

        :host([data-position="bottom-left"]) {
          bottom: 16px;
          left: 16px;
        }

        :host([data-position="bottom-right"]) {
          right: 16px;
          bottom: 16px;
        }

        .status {
          display: grid;
          grid-template-columns: 9px auto;
          column-gap: 8px;
          align-items: center;
          min-width: 142px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.92);
          padding: 9px 11px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
          color: #f8fafc;
          font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        }

        .dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: #94a3b8;
        }

        .status[data-state="content"] .dot {
          background: #22c55e;
        }

        .status[data-state="ad"] .dot {
          background: #f59e0b;
        }

        .status[data-state="candidate"] .dot {
          background: #38bdf8;
          animation: pulse 900ms ease-in-out infinite alternate;
        }

        .status[data-state="error"] .dot {
          background: #ef4444;
        }

        strong,
        small {
          display: block;
          grid-column: 2;
        }

        strong {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }

        small {
          margin-top: 2px;
          color: #cbd5e1;
          font-size: 9px;
          line-height: 1.35;
        }

        @keyframes pulse {
          from { opacity: 0.4; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1.15); }
        }
      </style>
      <div class="status" role="status">
        <span class="dot"></span>
        <strong></strong>
        <small></small>
      </div>
    `;

    overlayElements = {
      status: shadow.querySelector<HTMLDivElement>(".status")!,
      label: shadow.querySelector<HTMLElement>("strong")!,
      details: shadow.querySelector<HTMLElement>("small")!
    };
    mountTarget.appendChild(overlayHost);
    return overlayElements;
  }

  function removeOverlay(): void {
    overlayHost?.remove();
    overlayHost = null;
    overlayElements = null;
  }

  function renderOverlay(): void {
    if (!overlayEnabled || !latestInspection) {
      removeOverlay();
      return;
    }

    const elements = ensureOverlay();
    const isCandidate = latestPhase === "candidate";
    const stable = stableClassification;
    const raw = latestInspection.classification;
    const visualState = isCandidate ? "candidate" : stable;
    let label = visualState.toUpperCase();

    if (!isCandidate && stable === "ad") {
      if (tabAudioState.tabMuted) {
        label = "AD · MUTED";
      } else if (tabAudioState.manualAdOverride) {
        label = "AD · OVERRIDE";
      } else if (muteRetryAttempt > 0) {
        label = "AD · RETRYING";
      } else if (autoMuteEnabled) {
        label = "AD · MUTING";
      } else {
        label = "AD · OBSERVE";
      }
    }

    elements.status.dataset.state = visualState;
    elements.label.textContent = label;
    elements.details.textContent = isCandidate
      ? `raw: ${raw} · stable: ${stable} · v${extensionVersion}`
      : `stable: ${stable} · tab: ${
          tabAudioState.tabMuted ? "muted" : "audible"
        } · player: ${
          latestInspection.signals.playerMuted ? "muted" : "audible"
        } · source: ${tabAudioState.muteSource} · v${extensionVersion}`;
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

    if (overlayEnabled) {
      const elements = ensureOverlay();
      elements.status.dataset.state = "error";
      elements.label.textContent = "RELOAD PAGE";
      elements.details.textContent =
        `Extension updated; refresh this tab. · v${extensionVersion}`;
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
      document.querySelector(activeDetector.SELECTORS.player) ||
      document.querySelector(activeDetector.SELECTORS.fallbackPlayer)
    );
  }

  function refreshObserverTarget(): void {
    const player = findPlayer();
    const nextTarget = player || document.documentElement;

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

  function sendState(
    inspection: DetectorInspection,
    phase: DetectorPhase
  ): void {
    latestInspection = inspection;
    latestPhase = phase;
    renderOverlay();
    reconcileMuteRetry();

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

  function evaluatePlayer(): void {
    if (monitorStopped) {
      return;
    }

    refreshObserverTarget();
    const inspection = activeDetector.inspect(document);
    const nextClassification = inspection.classification;
    const now = Date.now();

    if (nextClassification !== candidateClassification) {
      candidateClassification = nextClassification;
      candidateSince = now;
    }

    const holdMs = activeTimingPolicy.holdFor(inspection);
    const elapsedMs = now - candidateSince;

    if (
      nextClassification !== stableClassification &&
      elapsedMs >= holdMs
    ) {
      stableClassification = nextClassification;
      sendState(inspection, "stable");
      return;
    }

    if (nextClassification !== stableClassification) {
      sendState(inspection, "candidate");
      scheduleEvaluation(Math.max(holdMs - elapsedMs, 50));
      return;
    }

    sendState(inspection, "stable");
  }

  const observer = new MutationObserver(() => scheduleEvaluation());
  const fullscreenObserver = new MutationObserver(() => {
    if (!overlayEnabled) {
      return;
    }

    ensureOverlay();
    renderOverlay();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    let shouldEvaluate = false;

    if (changes.enabled) {
      autoMuteEnabled = changes.enabled.newValue === true;
      lastMessageFingerprint = "";
      shouldEvaluate = true;
    }

    if (changes.showOverlay) {
      overlayEnabled = changes.showOverlay.newValue === true;
      shouldEvaluate = true;
    }

    if (changes.overlayPosition) {
      overlayPosition = activeOverlayPolicy.normalizePosition(
        changes.overlayPosition.newValue
      );
      renderOverlay();
    }

    if (shouldEvaluate) {
      evaluatePlayer();
    }
  });

  function applyTabAudioState(message: TabAudioStateMessage): void {
    autoMuteEnabled = message.enabled === true;
    tabAudioState = {
      tabMuted: message.tabMuted === true,
      mutedByExtension: message.mutedByExtension === true,
      manualAdOverride: message.manualAdOverride === true,
      muteSource: message.muteSource || "unknown"
    };
    reconcileMuteRetry();
    renderOverlay();
  }

  chrome.runtime.onMessage.addListener((message) => {
    const audioState = message as TabAudioStateMessage;

    if (audioState?.type !== "tab-audio-state") {
      return false;
    }

    applyTabAudioState(audioState);
    return false;
  });

  function handleFullscreenChange(): void {
    if (!overlayEnabled) {
      return;
    }

    ensureOverlay();
    renderOverlay();
  }

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener(
    "webkitfullscreenchange",
    handleFullscreenChange
  );

  chrome.storage.local
    .get({
      enabled: false,
      showOverlay: false,
      overlayPosition: activeOverlayPolicy.DEFAULT_POSITION
    })
    .then((storedSettings) => {
      const settings = storedSettings as ExtensionSettings;
      autoMuteEnabled = settings.enabled;
      overlayEnabled = settings.showOverlay;
      overlayPosition = activeOverlayPolicy.normalizePosition(
        settings.overlayPosition
      );
      renderOverlay();
    })
    .catch(handleRuntimeFailure);

  watchdogTimer = setInterval(
    evaluatePlayer,
    activeTimingPolicy.TIMING_MS.watchdog
  );
  evaluatePlayer();
})();
