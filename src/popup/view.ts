import type {
  DebugEvent,
  ExtensionSettings,
  PlayerClassification,
  PopupState,
  TabSessionRecord
} from "../shared/types.ts";

export const enabledInput = document.querySelector<HTMLInputElement>("#enabled")!;
const modeElement = document.querySelector<HTMLElement>("#mode")!;
export const showOverlayInput =
  document.querySelector<HTMLInputElement>("#show-overlay")!;
const overlayModeElement =
  document.querySelector<HTMLElement>("#overlay-mode")!;
export const overlayPositionInput =
  document.querySelector<HTMLSelectElement>("#overlay-position")!;
const classificationElement =
  document.querySelector<HTMLElement>("#classification")!;
const reasonElement = document.querySelector<HTMLElement>("#reason")!;
const dotElement = document.querySelector<HTMLElement>("#status-dot")!;
const diagnosticLogElement =
  document.querySelector<HTMLPreElement>("#diagnostic-log")!;
export const copyDiagnosticsButton =
  document.querySelector<HTMLButtonElement>("#copy-diagnostics")!;
const copyStatusElement =
  document.querySelector<HTMLElement>("#copy-status")!;
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

export function renderSettings({
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

export function render({ record = {}, ...settings }: PopupState): void {
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

export function renderUnavailable(error: unknown): void {
  renderDebugHistory();
  dotElement.className = "dot unknown";
  classificationElement.textContent = "Unavailable";
  reasonElement.textContent =
    error instanceof Error ? error.message : String(error);
}

export function setCopyStatus(message: string): void {
  copyStatusElement.textContent = message;
}
