import type {
  DetectorStateMessage,
  ExtensionSettings,
  OverlayPosition,
  TabAudioStateMessage
} from "../shared/types.ts";
import overlayStyles from "./overlay.css";
import { getMountTarget, normalizePosition } from "../shared/overlay-policy.ts";

type OverlayElements = Readonly<{
  status: HTMLDivElement;
  label: HTMLElement;
  details: HTMLElement;
}>;

export type OverlayAudioState = Pick<
  TabAudioStateMessage,
  "tabMuted" | "manualAdOverride" | "muteSource"
>;

type OverlayState = Readonly<{
  settings: ExtensionSettings;
  detector: DetectorStateMessage | undefined;
  audio: OverlayAudioState;
  retryAttempt: number;
  version: string;
}>;

let overlayHost: HTMLDivElement | null = null;
let overlayElements: OverlayElements | null = null;

function ensureOverlay(overlayPosition: OverlayPosition): OverlayElements {
  const mountTarget = getMountTarget(document);
  const position = normalizePosition(overlayPosition);

  if (overlayHost?.isConnected && overlayElements) {
    overlayHost.dataset.position = position;
    if (overlayHost.parentNode !== mountTarget) {
      mountTarget.appendChild(overlayHost);
    }
    return overlayElements;
  }

  overlayHost = document.createElement("div");
  overlayHost.id = "mlbtv-ad-muter-overlay-host";
  overlayHost.dataset.position = position;
  const shadow = overlayHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <div class="status" role="status">
      <span class="dot"></span>
      <strong></strong>
      <small></small>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = overlayStyles;
  shadow.appendChild(style);

  overlayElements = {
    status: shadow.querySelector<HTMLDivElement>(".status")!,
    label: shadow.querySelector<HTMLElement>("strong")!,
    details: shadow.querySelector<HTMLElement>("small")!
  };
  mountTarget.appendChild(overlayHost);
  return overlayElements;
}

export function removeOverlay(): void {
  overlayHost?.remove();
  overlayHost = null;
  overlayElements = null;
}

export function renderOverlay({
  settings,
  detector,
  audio,
  retryAttempt,
  version
}: OverlayState): void {
  if (!settings.showOverlay || !detector) {
    removeOverlay();
    return;
  }

  const elements = ensureOverlay(settings.overlayPosition);
  const isCandidate = detector.phase === "candidate";
  const stable = detector.stableClassification;
  const raw = detector.rawClassification;
  const visualState = isCandidate ? "candidate" : stable;
  const playerAudioState = detector.signals.playerMuted === null
    ? "unavailable"
    : detector.signals.playerMuted
      ? "muted"
      : "audible";
  let label = visualState.toUpperCase();

  if (!isCandidate && stable === "ad") {
    if (audio.tabMuted) {
      label = "AD · MUTED";
    } else if (audio.manualAdOverride) {
      label = "AD · OVERRIDE";
    } else if (retryAttempt > 0) {
      label = "AD · RETRYING";
    } else if (settings.enabled) {
      label = "AD · MUTING";
    } else {
      label = "AD · OBSERVE";
    }
  }

  elements.status.dataset.state = visualState;
  elements.label.textContent = label;
  const details = isCandidate
    ? [`raw: ${raw}`, `stable: ${stable}`]
    : [
      `stable: ${stable}`,
      `tab: ${audio.tabMuted ? "muted" : "audible"}`,
      `video: ${playerAudioState}`,
      `source: ${audio.muteSource}`
    ];
  elements.details.textContent = [...details, `v${version}`].join(" · ");
}

export function showReloadNotice(position: OverlayPosition, version: string): void {
  const elements = ensureOverlay(position);
  elements.status.dataset.state = "error";
  elements.label.textContent = "RELOAD PAGE";
  elements.details.textContent = `Extension updated; refresh this tab. · v${version}`;
}
