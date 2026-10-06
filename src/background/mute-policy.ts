import type {
  DetectorPhase,
  MuteDecision,
  MuteSource,
  PlayerClassification,
  TabMuteState
} from "../shared/types.ts";

export type DecideMuteActionInput = Readonly<{
  enabled: boolean;
  manualAdOverride?: boolean;
  phase: DetectorPhase;
  stableClassification: PlayerClassification;
}>;

export type PreserveAdMuteInput = Readonly<{
  adMuteLatched?: boolean;
  enabled: boolean;
  isSupportedStream: boolean;
  manualAdOverride?: boolean;
  stableClassification?: PlayerClassification;
}>;

export type RepairUnmuteInput = Readonly<{
  enabled: boolean;
  manualAdOverride?: boolean;
  muteSource: MuteSource;
  stableClassification?: PlayerClassification;
  tabMuted: boolean;
}>;

export function decideMuteAction({
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

export function classifyMuteSource(
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

export function describeTabMuteState(
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

export function shouldRepairUnmute({
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

export function shouldPreserveAdMuteOnNavigation({
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
