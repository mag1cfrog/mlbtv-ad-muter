(function initializeOverlayPolicy() {
  "use strict";

  const POSITIONS: readonly OverlayPosition[] = Object.freeze([
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right"
  ]);
  const DEFAULT_POSITION: OverlayPosition = "bottom-right";

  function normalizePosition(position: unknown): OverlayPosition {
    return typeof position === "string" &&
      POSITIONS.includes(position as OverlayPosition)
      ? position as OverlayPosition
      : DEFAULT_POSITION;
  }

  function getMountTarget(documentRoot: Document): Element {
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

  const policy: OverlayPolicy = Object.freeze({
    DEFAULT_POSITION,
    POSITIONS,
    normalizePosition,
    getMountTarget
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  (
    globalThis as typeof globalThis & {
      BaseballBreakOverlayPolicy: OverlayPolicy;
    }
  ).BaseballBreakOverlayPolicy = policy;
})();
