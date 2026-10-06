export type PlayerClassification = "ad" | "content" | "unknown";

export type DetectorPhase = "candidate" | "stable";

export type DetectorReason =
  | "explicit-ad-controls-marker-present"
  | "mixed-or-transitional-controls"
  | "only-minimal-playback-controls-present"
  | "player-or-video-missing"
  | "rich-playback-controls-present";

export type DetectorSignals = Readonly<{
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

export type DetectorClassification = Readonly<{
  classification: PlayerClassification;
  confidence: number;
  reason: DetectorReason;
}>;

export type DetectorInspection = DetectorClassification &
  Readonly<{ signals: DetectorSignals }>;

export type MuteAction = "ensure-muted" | "hold" | "release";

export type MuteSource =
  | "capture"
  | "other-extension"
  | "this-extension"
  | "unavailable"
  | "unknown"
  | "user";

export type MuteDecision = Readonly<{
  action: MuteAction;
  reason:
    | "auto-mute-disabled"
    | "manual-ad-override"
    | "stable-ad-state"
    | "stable-content-returned"
    | "transition-not-confirmed";
}>;

export type TabMuteState = Readonly<{
  tabMuted: boolean;
  muteSource: MuteSource;
  mutedByExtension: boolean;
}>;

export type OverlayPosition =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

export type ExtensionSettings = Readonly<{
  enabled: boolean;
  showOverlay: boolean;
  overlayPosition: OverlayPosition;
}>;

export type DetectorStateMessage = Readonly<{
  type: "detector-state";
  phase: DetectorPhase;
  // Raw is the current DOM reading; stable has passed the confirmation delay.
  stableClassification: PlayerClassification;
  rawClassification: PlayerClassification;
  confidence: number;
  reason: DetectorReason;
  signals: DetectorSignals;
}>;

export type DetectorRefreshMessage = Readonly<{
  type: "refresh-detector-state";
}>;

export type DetectorStateRequest = Readonly<{
  type: "get-detector-state";
}>;

export type TabAudioStateMessage = Readonly<{
  type: "tab-audio-state";
  enabled: boolean;
  tabMuted: boolean | null | undefined;
  manualAdOverride: boolean;
  muteSource: MuteSource;
}>;

export type DetectorErrorMessage = Readonly<{
  type: "detector-error";
  error: string;
}>;

export type DetectorResponse =
  | DetectorErrorMessage
  | TabAudioStateMessage
  | undefined;

export type NavigationDecision =
  | "preserve-ad-mute"
  | "release-navigation-mute";

export type DetectorDebugEvent = Readonly<{
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

export type MuteChangeDebugEvent = Readonly<{
  eventType: "tab-mute-change";
  at: number;
  tabMuted: boolean;
  muteSource: MuteSource;
  stableClassification: PlayerClassification;
}>;

export type ReconciliationDebugEvent = Readonly<{
  eventType: "mute-reconciliation";
  at: number;
  stableClassification: PlayerClassification | undefined;
  tabMuted: boolean | null | undefined;
  muteSource: MuteSource | undefined;
}>;

export type NavigationDebugEvent = Readonly<{
  eventType: "navigation";
  at: number;
  decision: NavigationDecision;
  adMuteLatched: boolean;
  mutedByExtension: boolean;
  tabMuted: boolean | null | undefined;
  muteSource: MuteSource | undefined;
}>;

export type DebugEvent =
  | DetectorDebugEvent
  | MuteChangeDebugEvent
  | NavigationDebugEvent
  | ReconciliationDebugEvent;

// Navigation and audio events can arrive before the first detector message.
export type TabSessionRecord = {
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
  // Preserves an established ad mute while a supported stream reloads.
  adMuteLatched?: boolean;
  lastDecision?: MuteAction | NavigationDecision;
  debugHistory?: DebugEvent[];
};

export type PopupState = Readonly<ExtensionSettings & {
  record: TabSessionRecord;
}>;

export type DiagnosticPopupState = Readonly<PopupState & {
  extensionVersion: string;
  generatedAt: string;
  tabId: number;
}>;
