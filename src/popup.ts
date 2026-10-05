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
let refreshSequence = 0;
const popupOverlayPolicy = (globalThis as ExtensionGlobals)
  .MlbTvAdMuterOverlayPolicy!;

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

function renderSettings({
  enabled,
  showOverlay,
  overlayPosition
}: ExtensionSettings): void {
  enabledInput.checked = enabled;
  showOverlayInput.checked = showOverlay;
  overlayPositionInput.value = overlayPosition;
  modeElement.textContent = enabled
    ? "Auto-mute enabled"
    : "Observation mode";
  overlayModeElement.textContent = showOverlay
    ? "Overlay visible"
    : "Overlay hidden";
}

function render({ record = {}, ...settings }: PopupState): void {
  const classification = record.stableClassification || "unknown";
  renderSettings(settings);
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
  const sequence = ++refreshSequence;
  try {
    const [storedSettings, activeTab] = await Promise.all([
      chrome.storage.local.get({
        enabled: false,
        showOverlay: false,
        overlayPosition: popupOverlayPolicy.DEFAULT_POSITION
      }),
      getActiveTab()
    ]);
    if (sequence !== refreshSequence) {
      return;
    }
    const settings = {
      ...storedSettings,
      overlayPosition: popupOverlayPolicy.normalizePosition(
        storedSettings.overlayPosition
      )
    } as ExtensionSettings;
    renderSettings(settings);

    if (typeof activeTab?.id !== "number") {
      activeTabId = null;
      lastPopupState = null;
      render({ ...settings, record: {} });
      return;
    }

    activeTabId = activeTab.id;
    const key = `tab:${activeTab.id}`;
    const storedState = await chrome.storage.session.get(key);
    let record: TabSessionRecord = storedState[key] || {};
    try {
      const liveState = await chrome.tabs.sendMessage(activeTab.id, {
        type: "get-detector-state"
      } satisfies DetectorStateRequest) as DetectorStateMessage | undefined;
      if (liveState?.type === "detector-state") {
        const { type: _type, ...detection } = liveState;
        record = { ...record, ...detection };
      }
    } catch {
      // Tabs outside the supported player do not have a content monitor.
    }
    if (sequence !== refreshSequence) {
      return;
    }

    const state = {
      ...settings,
      record: {
        ...record,
        tabMuted: activeTab.mutedInfo?.muted ?? record.tabMuted
      }
    };
    lastPopupState = {
      extensionVersion: chrome.runtime.getManifest().version,
      generatedAt: new Date().toISOString(),
      tabId: activeTab.id,
      ...state
    };
    render(state);
  } catch (error) {
    if (sequence === refreshSequence) {
      handleRefreshError(error);
    }
  }
}

function handleRefreshError(error: unknown): void {
  lastPopupState = null;
  renderDebugHistory();
  dotElement.className = "dot unknown";
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
  if (areaName === "local" || (
    areaName === "session" &&
    activeTabId !== null &&
    changes[`tab:${activeTabId}`]
  )) {
    refresh();
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "detector-state" && sender.tab?.id === activeTabId) {
    refresh();
  }
  return false;
});

refresh();
