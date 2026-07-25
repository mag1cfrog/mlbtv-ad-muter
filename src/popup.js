"use strict";

const enabledInput = document.querySelector("#enabled");
const modeElement = document.querySelector("#mode");
const showOverlayInput = document.querySelector("#show-overlay");
const overlayModeElement = document.querySelector("#overlay-mode");
const classificationElement = document.querySelector("#classification");
const reasonElement = document.querySelector("#reason");
const dotElement = document.querySelector("#status-dot");
const diagnosticLogElement = document.querySelector("#diagnostic-log");
const copyDiagnosticsButton = document.querySelector("#copy-diagnostics");
const copyStatusElement = document.querySelector("#copy-status");
let lastPopupState = null;

const CLASSIFICATION_LABELS = Object.freeze({
  content: "Game content",
  ad: "Commercial break",
  unknown: "Unknown"
});

const REASON_LABELS = Object.freeze({
  "explicit-ad-controls-marker-present":
    "The player’s commercial-controls marker is present.",
  "rich-playback-controls-present":
    "Rich playback and live controls are present.",
  "only-minimal-playback-controls-present":
    "Only basic pause and volume controls are present.",
  "player-or-video-missing": "The supported player is not currently available.",
  "mixed-or-transitional-controls": "The player appears to be transitioning."
});

function renderDebugHistory(history = []) {
  if (!history.length) {
    diagnosticLogElement.textContent = "No transitions recorded yet.";
    return;
  }

  diagnosticLogElement.textContent = history
    .slice(-10)
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString();

      if (event.eventType === "tab-mute-change") {
        return [
          time,
          event.tabMuted ? "tab muted" : "tab audible",
          `(${event.muteSource})`
        ].join(" ");
      }

      if (event.eventType === "mute-reconciliation") {
        return `${time} repaired unintended tab unmute`;
      }

      return [
        time,
        `${event.rawClassification} → ${event.stableClassification}`,
        `(${event.phase})`,
        event.decision
      ].join(" ");
    })
    .join("\n");
}

function render({ enabled, showOverlay, record = {} }) {
  const classification = record.stableClassification || "unknown";
  enabledInput.checked = enabled;
  showOverlayInput.checked = showOverlay;
  modeElement.textContent = enabled
    ? "Auto-mute enabled"
    : "Observation mode";
  overlayModeElement.textContent = showOverlay
    ? "Overlay visible"
    : "Overlay hidden";
  classificationElement.textContent =
    CLASSIFICATION_LABELS[classification] || "Unknown";
  reasonElement.textContent =
    REASON_LABELS[record.reason] || "Waiting for player-state evidence.";
  dotElement.className = `dot ${classification}`;
  renderDebugHistory(record.debugHistory);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0];
}

async function refresh() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    render({
      enabled: false,
      showOverlay: false,
      record: {}
    });
    return;
  }

  const state = await chrome.runtime.sendMessage({
    type: "get-popup-state",
    tabId: activeTab.id
  });
  lastPopupState = {
    extensionVersion: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    tabId: activeTab.id,
    ...state
  };
  render(state);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();

    if (!copied) {
      throw new Error("Clipboard access was unavailable.");
    }
  }
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    enabled: enabledInput.checked
  });
  await refresh();
});

showOverlayInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    showOverlay: showOverlayInput.checked
  });
  await refresh();
});

copyDiagnosticsButton.addEventListener("click", async () => {
  if (!lastPopupState) {
    copyStatusElement.textContent = "Nothing to copy yet.";
    return;
  }

  try {
    await copyText(JSON.stringify(lastPopupState, null, 2));
    copyStatusElement.textContent = "Copied.";
  } catch {
    copyStatusElement.textContent = "Copy failed.";
  }
});

refresh().catch((error) => {
  classificationElement.textContent = "Unavailable";
  reasonElement.textContent = error.message;
});
