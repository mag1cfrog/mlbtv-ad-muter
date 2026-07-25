"use strict";

const enabledInput = document.querySelector<HTMLInputElement>("#enabled")!;
const modeElement = document.querySelector<HTMLElement>("#mode")!;
const showOverlayInput =
  document.querySelector<HTMLInputElement>("#show-overlay")!;
const overlayModeElement =
  document.querySelector<HTMLElement>("#overlay-mode")!;
const overlayPositionInput =
  document.querySelector<HTMLSelectElement>("#overlay-position")!;
const classificationElement =
  document.querySelector<HTMLElement>("#classification")!;
const reasonElement = document.querySelector<HTMLElement>("#reason")!;
const dotElement = document.querySelector<HTMLElement>("#status-dot")!;
const diagnosticLogElement =
  document.querySelector<HTMLPreElement>("#diagnostic-log")!;
const copyDiagnosticsButton =
  document.querySelector<HTMLButtonElement>("#copy-diagnostics")!;
const copyStatusElement =
  document.querySelector<HTMLElement>("#copy-status")!;
let activeTabId: number | null = null;
let lastPopupState: DiagnosticPopupState | null = null;

const CLASSIFICATION_LABELS: Readonly<
  Record<PlayerClassification, string>
> = Object.freeze({
  content: "Game content",
  ad: "Commercial break",
  unknown: "Unknown"
});

const REASON_LABELS: Readonly<
  Partial<Record<NonNullable<TabSessionRecord["reason"]>, string>>
> = Object.freeze({
  "explicit-ad-controls-marker-present":
    "An on-screen commercial-break marker is present.",
  "rich-playback-controls-present":
    "Rich playback and live controls are present.",
  "only-minimal-playback-controls-present":
    "Only basic pause and volume controls are present.",
  "player-or-video-missing":
    "The supported video interface is not currently available.",
  "mixed-or-transitional-controls":
    "The video interface appears to be transitioning."
});

function renderDebugHistory(history: readonly DebugEvent[] = []): void {
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

      if (event.eventType === "navigation") {
        return `${time} navigation: ${event.decision}`;
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

function render({
  enabled,
  showOverlay,
  overlayPosition = "bottom-right",
  record = {}
}: PopupStateResponse): void {
  const classification = record.stableClassification || "unknown";
  enabledInput.checked = enabled;
  showOverlayInput.checked = showOverlay;
  overlayPositionInput.value = overlayPosition;
  modeElement.textContent = enabled
    ? "Auto-mute enabled"
    : "Observation mode";
  overlayModeElement.textContent = showOverlay
    ? "Overlay visible"
    : "Overlay hidden";
  classificationElement.textContent =
    CLASSIFICATION_LABELS[classification] || "Unknown";
  reasonElement.textContent =
    (record.reason && REASON_LABELS[record.reason]) ||
    "Waiting for on-screen video evidence.";
  dotElement.className = `dot ${classification}`;
  renderDebugHistory(record.debugHistory);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0];
}

async function refresh(): Promise<void> {
  const activeTab = await getActiveTab();

  if (typeof activeTab?.id !== "number") {
    activeTabId = null;
    render({
      enabled: false,
      showOverlay: false,
      overlayPosition: "bottom-right",
      record: {}
    });
    return;
  }

  activeTabId = activeTab.id;
  const response = await chrome.runtime.sendMessage({
    type: "get-popup-state",
    tabId: activeTab.id
  } satisfies PopupStateRequest) as PopupRuntimeResponse;

  if (!response) {
    throw new Error("The background worker did not return popup state.");
  }
  if ("error" in response) {
    throw new Error(response.error);
  }

  const state = response;
  lastPopupState = {
    extensionVersion: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    tabId: activeTab.id,
    ...state
  };
  render(state);
}

function handleRefreshError(error: unknown): void {
  classificationElement.textContent = "Unavailable";
  reasonElement.textContent =
    error instanceof Error ? error.message : String(error);
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

overlayPositionInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    overlayPosition: overlayPositionInput.value
  });
  await refresh();
});

copyDiagnosticsButton.addEventListener("click", async () => {
  if (!lastPopupState) {
    copyStatusElement.textContent = "Nothing to copy yet.";
    return;
  }

  try {
    await navigator.clipboard.writeText(
      JSON.stringify(lastPopupState, null, 2)
    );
    copyStatusElement.textContent = "Copied.";
  } catch {
    copyStatusElement.textContent = "Copy failed.";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "session" ||
    activeTabId === null ||
    !changes[`tab:${activeTabId}`]
  ) {
    return;
  }

  refresh().catch(handleRefreshError);
});

refresh().catch(handleRefreshError);
