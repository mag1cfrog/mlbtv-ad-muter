(function initializeTimingPolicy(root, factory) {
  const policy = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  root.BaseballBreakTimingPolicy = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTimingPolicy() {
  "use strict";

  const TIMING_MS = Object.freeze({
    debounce: 80,
    explicitAd: 300,
    heuristicAd: 900,
    content: 2000,
    unknown: 1200,
    watchdog: 1500
  });

  function holdFor(inspection) {
    if (
      inspection.classification === "ad" &&
      inspection.reason === "explicit-ad-controls-marker-present"
    ) {
      return TIMING_MS.explicitAd;
    }

    if (inspection.classification === "ad") {
      return TIMING_MS.heuristicAd;
    }

    if (inspection.classification === "content") {
      return TIMING_MS.content;
    }

    return TIMING_MS.unknown;
  }

  return Object.freeze({
    TIMING_MS,
    holdFor
  });
});
