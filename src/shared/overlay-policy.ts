import type { OverlayPosition } from "./types.ts";

export const POSITIONS: readonly OverlayPosition[] = Object.freeze([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);
export const DEFAULT_POSITION: OverlayPosition = "bottom-right";

export function normalizePosition(position: unknown): OverlayPosition {
  return typeof position === "string" &&
    POSITIONS.includes(position as OverlayPosition)
    ? position as OverlayPosition
    : DEFAULT_POSITION;
}

export function getMountTarget(documentRoot: Document): Element {
  const webkitDocument = documentRoot as Document & {
    webkitFullscreenElement?: Element | null;
  };

  return (
    documentRoot.fullscreenElement ||
    webkitDocument.webkitFullscreenElement ||
    documentRoot.querySelector(".mlbtv-player--full-screen") ||
    documentRoot.documentElement
  );
}
