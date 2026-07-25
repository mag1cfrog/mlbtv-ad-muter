(function initializeOverlayPolicy(root, factory) {
  const policy = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  root.BaseballBreakOverlayPolicy = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOverlayPolicy() {
  "use strict";

  const POSITIONS = Object.freeze([
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right"
  ]);
  const DEFAULT_POSITION = "bottom-right";

  function normalizePosition(position) {
    return POSITIONS.includes(position) ? position : DEFAULT_POSITION;
  }

  function getMountTarget(documentRoot) {
    return (
      documentRoot.fullscreenElement ||
      documentRoot.webkitFullscreenElement ||
      documentRoot.querySelector?.(".mlbtv-player--full-screen") ||
      documentRoot.documentElement
    );
  }

  return Object.freeze({
    DEFAULT_POSITION,
    POSITIONS,
    normalizePosition,
    getMountTarget
  });
});
