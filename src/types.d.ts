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
  confirmationDelayFor(
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
  tabMuted: boolean | null | undefined;
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

type NavigationDecision =
  | "preserve-ad-mute"
  | "release-navigation-mute";

type DetectorDebugEvent = Readonly<{
  eventType: "detector-state";
  at: number;
  phase: DetectorPhase;
  rawClassification: PlayerClassification;
  stableClassification: PlayerClassification;
  reason: DetectorReason;
  decision: MuteAction;
  decisionReason: MuteDecision["reason"];
  mutedByExtension: boolean;
  tabMuted: boolean | null | undefined;
  muteSource: MuteSource | undefined;
  signals: DetectorSignals;
}>;

type MuteChangeDebugEvent = Readonly<{
  eventType: "tab-mute-change";
  at: number;
  tabMuted: boolean;
  muteSource: MuteSource;
  stableClassification: PlayerClassification;
}>;

type ReconciliationDebugEvent = Readonly<{
  eventType: "mute-reconciliation";
  at: number;
  stableClassification: PlayerClassification | undefined;
  tabMuted: boolean | null | undefined;
  muteSource: MuteSource | undefined;
}>;

type NavigationDebugEvent = Readonly<{
  eventType: "navigation";
  at: number;
  decision: NavigationDecision;
  adMuteLatched: boolean;
  mutedByExtension: boolean;
  tabMuted: boolean | null | undefined;
  muteSource: MuteSource | undefined;
}>;

type DebugEvent =
  | DetectorDebugEvent
  | MuteChangeDebugEvent
  | NavigationDebugEvent
  | ReconciliationDebugEvent;

type TabSessionRecord = {
  phase?: DetectorPhase;
  stableClassification?: PlayerClassification;
  rawClassification?: PlayerClassification;
  confidence?: number;
  reason?: DetectorReason | "navigation";
  signals?: DetectorSignals;
  updatedAt?: number;
  tabMuted?: boolean | null;
  muteSource?: MuteSource;
  mutedByExtension?: boolean;
  manualAdOverride?: boolean;
  adMuteLatched?: boolean;
  lastDecision?: MuteAction | NavigationDecision;
  debugHistory?: DebugEvent[];
};

type PopupStateRequest = Readonly<{
  type: "get-popup-state";
  tabId: number;
}>;

type PopupStateResponse = Readonly<ExtensionSettings & {
  record: TabSessionRecord;
}>;

type PopupErrorResponse = Readonly<{ error: string }>;

type PopupRuntimeResponse =
  | PopupErrorResponse
  | PopupStateResponse
  | undefined;

type DiagnosticPopupState = Readonly<PopupStateResponse & {
  extensionVersion: string;
  generatedAt: string;
  tabId: number;
}>;

type ExtensionGlobals = typeof globalThis & {
  BaseballBreakDetector?: DetectorPolicy;
  BaseballBreakMutePolicy?: MutePolicy;
  BaseballBreakOverlayPolicy?: OverlayPolicy;
  BaseballBreakTimingPolicy?: TimingPolicy;
};

declare const module: { exports: unknown } | undefined;
declare function importScripts(...urls: string[]): void;
