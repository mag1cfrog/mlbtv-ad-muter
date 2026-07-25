(function startContentMonitor() {
  "use strict";

  const detector = globalThis.BaseballBreakDetector;
  const timingPolicy = globalThis.BaseballBreakTimingPolicy;

  if (!detector || !timingPolicy) {
    console.error("Baseball Break Muter: detector dependencies failed to load.");
    return;
  }

  let stableClassification = "unknown";
  let candidateClassification = null;
  let candidateSince = 0;
  let evaluationTimer = null;
  let lastMessageFingerprint = "";
  let observedTarget = null;
  let overlayEnabled = false;
  let autoMuteEnabled = false;
  let overlayHost = null;
  let overlayElements = null;
  let latestInspection = null;
  let latestPhase = "stable";
  let tabAudioState = {
    tabMuted: false,
    mutedByExtension: false,
    muteSource: "unknown"
  };

  function scheduleEvaluation(delayMs = timingPolicy.TIMING_MS.debounce) {
    if (evaluationTimer !== null) {
      clearTimeout(evaluationTimer);
    }

    evaluationTimer = setTimeout(() => {
      evaluationTimer = null;
      evaluatePlayer();
    }, delayMs);
  }

  function ensureOverlay() {
    if (overlayHost?.isConnected && overlayElements) {
      return overlayElements;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = "baseball-break-muter-overlay-host";
    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          pointer-events: none;
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
    document.documentElement.append(overlayHost);
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
        } · source: ${tabAudioState.muteSource}`;
  }

  function findPlayer() {
    return (
      document.querySelector(detector.SELECTORS.player) ||
      document.querySelector(detector.SELECTORS.fallbackPlayer)
    );
  }

  function refreshObserverTarget() {
    const nextTarget = findPlayer() || document.documentElement;

    if (nextTarget === observedTarget) {
      return;
    }

    observer.disconnect();
    observer.observe(nextTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label", "class"]
    });
    observedTarget = nextTarget;
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
    chrome.runtime.sendMessage(payload).catch(() => {
      // The service worker can be briefly unavailable while Chrome restarts it.
    });
  }

  function evaluatePlayer() {
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
      muteSource: message.muteSource || "unknown"
    };
    renderOverlay();
    return false;
  });

  chrome.storage.local
    .get({
      enabled: false,
      showOverlay: false
    })
    .then((settings) => {
      autoMuteEnabled = settings.enabled;
      overlayEnabled = settings.showOverlay;
      renderOverlay();
    });

  setInterval(evaluatePlayer, timingPolicy.TIMING_MS.watchdog);
  evaluatePlayer();
})();
