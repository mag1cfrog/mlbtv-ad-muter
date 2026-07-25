(function startContentMonitor() {
  "use strict";

  const detector = globalThis.BaseballBreakDetector;
  const overlayPolicy = globalThis.BaseballBreakOverlayPolicy;
  const timingPolicy = globalThis.BaseballBreakTimingPolicy;

  if (!detector || !overlayPolicy || !timingPolicy) {
    console.error("Baseball Break Muter: detector dependencies failed to load.");
    return;
  }

  let stableClassification = "unknown";
  let candidateClassification = null;
  let candidateSince = 0;
  let evaluationTimer = null;
  let watchdogTimer = null;
  let lastMessageFingerprint = "";
  let observedTarget = null;
  let observedFullscreenTarget = null;
  let overlayEnabled = false;
  let overlayPosition = overlayPolicy.DEFAULT_POSITION;
  let autoMuteEnabled = false;
  let overlayHost = null;
  let overlayElements = null;
  let latestInspection = null;
  let latestPhase = "stable";
  let monitorStopped = false;
  let tabAudioState = {
    tabMuted: false,
    mutedByExtension: false,
    manualAdOverride: false,
    muteSource: "unknown"
  };

  function scheduleEvaluation(delayMs = timingPolicy.TIMING_MS.debounce) {
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

  function ensureOverlay() {
    const mountTarget = overlayPolicy.getMountTarget(document);
    const position = overlayPolicy.normalizePosition(overlayPosition);

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
      status: shadow.querySelector(".status"),
      label: shadow.querySelector("strong"),
      details: shadow.querySelector("small")
    };
    mountTarget.appendChild(overlayHost);
    return overlayElements;
  }

  function removeOverlay() {
    overlayHost?.remove();
    overlayHost = null;
    overlayElements = null;
  }

  function renderOverlay() {
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
      } else if (autoMuteEnabled) {
        label = "AD · MUTING";
      } else {
        label = "AD · OBSERVE";
      }
    }

    elements.status.dataset.state = visualState;
    elements.label.textContent = label;
    elements.details.textContent = isCandidate
      ? `raw: ${raw} · stable: ${stable}`
      : `stable: ${stable} · tab: ${
          tabAudioState.tabMuted ? "muted" : "audible"
        } · player: ${
          latestInspection.signals.playerMuted ? "muted" : "audible"
        } · source: ${tabAudioState.muteSource}`;
  }

  function stopForInvalidatedContext() {
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
    observer.disconnect();
    fullscreenObserver.disconnect();

    if (overlayEnabled) {
      const elements = ensureOverlay();
      elements.status.dataset.state = "error";
      elements.label.textContent = "RELOAD PAGE";
      elements.details.textContent =
        "Extension updated; refresh this tab.";
    } else {
      removeOverlay();
    }
  }

  function handleRuntimeFailure(error) {
    const message = String(error?.message || error || "");

    if (message.includes("Extension context invalidated")) {
      stopForInvalidatedContext();
    }
  }

  function findPlayer() {
    return (
      document.querySelector(detector.SELECTORS.player) ||
      document.querySelector(detector.SELECTORS.fallbackPlayer)
    );
  }

  function refreshObserverTarget() {
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

  function sendState(inspection, phase) {
    latestInspection = inspection;
    latestPhase = phase;
    renderOverlay();

    const payload = {
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
      chrome.runtime.sendMessage(payload).catch(handleRuntimeFailure);
    } catch (error) {
      handleRuntimeFailure(error);
    }
  }

  function evaluatePlayer() {
    if (monitorStopped) {
      return;
    }

    refreshObserverTarget();
    const inspection = detector.inspect(document);
    const nextClassification = inspection.classification;
    const now = Date.now();

    if (nextClassification !== candidateClassification) {
      candidateClassification = nextClassification;
      candidateSince = now;
    }

    const holdMs = timingPolicy.holdFor(inspection);
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
      overlayPosition = overlayPolicy.normalizePosition(
        changes.overlayPosition.newValue
      );
      renderOverlay();
    }

    if (shouldEvaluate) {
      evaluatePlayer();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "tab-audio-state") {
      return false;
    }

    autoMuteEnabled = message.enabled === true;
    tabAudioState = {
      tabMuted: message.tabMuted === true,
      mutedByExtension: message.mutedByExtension === true,
      manualAdOverride: message.manualAdOverride === true,
      muteSource: message.muteSource || "unknown"
    };
    renderOverlay();
    return false;
  });

  function handleFullscreenChange() {
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
      overlayPosition: overlayPolicy.DEFAULT_POSITION
    })
    .then((settings) => {
      autoMuteEnabled = settings.enabled;
      overlayEnabled = settings.showOverlay;
      overlayPosition = overlayPolicy.normalizePosition(
        settings.overlayPosition
      );
      renderOverlay();
    })
    .catch(handleRuntimeFailure);

  watchdogTimer = setInterval(
    evaluatePlayer,
    timingPolicy.TIMING_MS.watchdog
  );
  evaluatePlayer();
})();
