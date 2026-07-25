(function initializeMutePolicy() {
  "use strict";

  function decideMuteAction({
    enabled,
    manualAdOverride = false,
    phase,
    stableClassification
  }: DecideMuteActionInput): MuteDecision {
    if (!enabled) {
      return {
        action: "release",
        reason: "auto-mute-disabled"
      };
    }

    if (stableClassification === "ad") {
      if (manualAdOverride) {
        return {
          action: "hold",
          reason: "manual-ad-override"
        };
      }

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

  function classifyMuteSource(
    mutedInfo: chrome.tabs.MutedInfo | undefined,
    runtimeId: string
  ): MuteSource {
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

  function describeTabMuteState(
    mutedInfo: chrome.tabs.MutedInfo | undefined,
    runtimeId: string
  ): TabMuteState {
    const tabMuted = Boolean(mutedInfo?.muted);
    const muteSource = classifyMuteSource(mutedInfo, runtimeId);

    return {
      tabMuted,
      muteSource,
      mutedByExtension:
        tabMuted && muteSource === "this-extension"
    };
  }

  function shouldRepairUnmute({
    enabled,
    manualAdOverride = false,
    muteSource,
    stableClassification,
    tabMuted
  }: RepairUnmuteInput): boolean {
    return (
      enabled &&
      stableClassification === "ad" &&
      tabMuted === false &&
      muteSource === "this-extension" &&
      !manualAdOverride
    );
  }

  function shouldPreserveAdMuteOnNavigation({
    adMuteLatched = false,
    enabled,
    isSupportedStream,
    manualAdOverride = false,
    stableClassification
  }: PreserveAdMuteInput): boolean {
    return (
      enabled &&
      isSupportedStream &&
      (adMuteLatched || stableClassification === "ad") &&
      !manualAdOverride
    );
  }

  const policy: MutePolicy = Object.freeze({
    classifyMuteSource,
    describeTabMuteState,
    decideMuteAction,
    shouldPreserveAdMuteOnNavigation,
    shouldRepairUnmute
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  (
    globalThis as typeof globalThis & {
      BaseballBreakMutePolicy: MutePolicy;
    }
  ).BaseballBreakMutePolicy = policy;
})();
