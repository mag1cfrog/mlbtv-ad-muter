(function initializeMutePolicy(root, factory) {
  const policy = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  root.BaseballBreakMutePolicy = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMutePolicy() {
  "use strict";

  function decideMuteAction({
    enabled,
    phase,
    stableClassification
  }) {
    if (!enabled) {
      return {
        action: "release",
        reason: "auto-mute-disabled"
      };
    }

    if (stableClassification === "ad") {
      return {
        action: "ensure-muted",
        reason: "stable-ad-state"
      };
    }

    if (
      phase === "stable" &&
      stableClassification === "content"
    ) {
      return {
        action: "release",
        reason: "stable-content-returned"
      };
    }

    return {
      action: "hold",
      reason: "transition-not-confirmed"
    };
  }

  function classifyMuteSource(mutedInfo, runtimeId) {
    if (!mutedInfo?.reason) {
      return "unknown";
    }

    if (mutedInfo.reason === "extension") {
      return mutedInfo.extensionId === runtimeId
        ? "this-extension"
        : "other-extension";
    }

    if (mutedInfo.reason === "user" || mutedInfo.reason === "capture") {
      return mutedInfo.reason;
    }

    return "unknown";
  }

  return Object.freeze({
    classifyMuteSource,
    decideMuteAction
  });
});
