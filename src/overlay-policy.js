(function initializeOverlayPolicy(root, factory) {
  const policy = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  root.BaseballBreakOverlayPolicy = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOverlayPolicy() {
  "use strict";

  function getMountTarget(documentRoot) {
    return (
      documentRoot.fullscreenElement ||
      documentRoot.webkitFullscreenElement ||
      documentRoot.querySelector?.(".mlbtv-player--full-screen") ||
      documentRoot.documentElement
    );
  }

  return Object.freeze({
    getMountTarget
  });
});
