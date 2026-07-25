type PlayerClassification = "ad" | "content" | "unknown";
type DetectorPhase = "candidate" | "stable";

type DetectorReason =
  | "explicit-ad-controls-marker-present"
  | "mixed-or-transitional-controls"
  | "only-minimal-playback-controls-present"
  | "player-or-video-missing"
  | "rich-playback-controls-present";

type DetectorSignals = Readonly<{
  hasPlayer: boolean;
  hasVideo: boolean;
  playerMuted: boolean | null;
  hasAdControls: boolean;
  hasPlayPause: boolean;
  hasVolume: boolean;
  hasRewind: boolean;
  hasFastForward: boolean;
  hasSeekSlider: boolean;
  hasLivePoint: boolean;
  hasBroadcast: boolean;
  hasQuality: boolean;
  hasFullscreen: boolean;
}>;

type DetectorClassification = Readonly<{
  classification: PlayerClassification;
  confidence: number;
  reason: DetectorReason;
}>;

type DetectorInspection = DetectorClassification &
  Readonly<{ signals: DetectorSignals }>;

type DetectorSelectors = Readonly<{
  player: string;
  fallbackPlayer: string;
  video: string;
  adControls: string;
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  rewind: string;
  fastForward: string;
  seekSlider: string;
  livePoint: string;
  broadcast: string;
  quality: string;
  fullscreen: string;
}>;

type DetectorPolicy = Readonly<{
  SELECTORS: DetectorSelectors;
  classifySignals(signals: DetectorSignals): DetectorClassification;
  collectSignals(documentRoot: ParentNode): DetectorSignals;
  inspect(documentRoot: ParentNode): DetectorInspection;
}>;

type MuteAction = "ensure-muted" | "hold" | "release";
type MuteSource =
  | "capture"
  | "other-extension"
  | "this-extension"
  | "unavailable"
  | "unknown"
  | "user";

type MuteDecision = Readonly<{
  action: MuteAction;
  reason:
    | "auto-mute-disabled"
    | "manual-ad-override"
    | "stable-ad-state"
    | "stable-content-returned"
    | "transition-not-confirmed";
}>;

type TabMuteState = Readonly<{
  tabMuted: boolean;
  muteSource: MuteSource;
  mutedByExtension: boolean;
  wasMutedBeforeAd: boolean;
}>;

type DecideMuteActionInput = Readonly<{
  enabled: boolean;
  manualAdOverride?: boolean;
  phase: DetectorPhase;
  stableClassification: PlayerClassification;
}>;

type PreserveAdMuteInput = Readonly<{
  adMuteLatched?: boolean;
  enabled: boolean;
  isSupportedStream: boolean;
  manualAdOverride?: boolean;
  stableClassification?: PlayerClassification;
}>;

type RepairUnmuteInput = Readonly<{
  enabled: boolean;
  manualAdOverride?: boolean;
  muteSource: MuteSource;
  stableClassification?: PlayerClassification;
  tabMuted: boolean;
}>;

type MutePolicy = Readonly<{
  classifyMuteSource(
    mutedInfo: chrome.tabs.MutedInfo | undefined,
    runtimeId: string
  ): MuteSource;
  describeTabMuteState(
    mutedInfo: chrome.tabs.MutedInfo | undefined,
    runtimeId: string
  ): TabMuteState;
  decideMuteAction(input: DecideMuteActionInput): MuteDecision;
  shouldPreserveAdMuteOnNavigation(input: PreserveAdMuteInput): boolean;
  shouldRepairUnmute(input: RepairUnmuteInput): boolean;
}>;

type OverlayPosition =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

type OverlayPolicy = Readonly<{
  DEFAULT_POSITION: OverlayPosition;
  POSITIONS: readonly OverlayPosition[];
  normalizePosition(position: unknown): OverlayPosition;
  getMountTarget(documentRoot: Document): Element;
}>;

type TimingPolicy = Readonly<{
  TIMING_MS: Readonly<{
    debounce: number;
    explicitAd: number;
    heuristicAd: number;
    content: number;
    unknown: number;
    muteAcknowledgment: number;
    muteRetryMaximum: number;
    watchdog: number;
  }>;
  holdFor(
    inspection: Pick<DetectorClassification, "classification" | "reason">
  ): number;
  muteRetryDelay(attempt: number): number;
}>;

type ExtensionSettings = Readonly<{
  enabled: boolean;
  showOverlay: boolean;
  overlayPosition: OverlayPosition;
}>;

type DetectorStateMessage = Readonly<{
  type: "detector-state";
  phase: DetectorPhase;
  stableClassification: PlayerClassification;
  rawClassification: PlayerClassification;
  confidence: number;
  reason: DetectorReason;
  signals: DetectorSignals;
}>;

type TabAudioStateMessage = Readonly<{
  type: "tab-audio-state";
  enabled: boolean;
  tabMuted: boolean | null;
  mutedByExtension: boolean;
  manualAdOverride: boolean;
  muteSource: MuteSource;
}>;

type DetectorErrorMessage = Readonly<{
  type: "detector-error";
  error: string;
}>;

type DetectorResponse =
  | DetectorErrorMessage
  | TabAudioStateMessage
  | undefined;

type ExtensionGlobals = typeof globalThis & {
  BaseballBreakDetector?: DetectorPolicy;
  BaseballBreakMutePolicy?: MutePolicy;
  BaseballBreakOverlayPolicy?: OverlayPolicy;
  BaseballBreakTimingPolicy?: TimingPolicy;
};

declare const module: { exports: unknown } | undefined;
