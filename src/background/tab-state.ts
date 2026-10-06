import type {
  DebugEvent,
  DetectorDebugEvent,
  DetectorStateMessage,
  MuteChangeDebugEvent,
  MuteDecision,
  NavigationDebugEvent,
  NavigationDecision,
  ReconciliationDebugEvent,
  TabSessionRecord
} from "../shared/types.ts";
import { classifyMuteSource } from "./mute-policy.ts";

const DEBUG_HISTORY_LIMIT = 40;

function appendDebugEvent(
  record: TabSessionRecord,
  event: DebugEvent
): DebugEvent[] {
  const history = Array.isArray(record.debugHistory)
    ? record.debugHistory
    : [];

  return [
    ...history.slice(-(DEBUG_HISTORY_LIMIT - 1)),
    event
  ];
}

export function recordDetection(
  previous: TabSessionRecord,
  record: TabSessionRecord,
  message: DetectorStateMessage,
  decision: MuteDecision
): TabSessionRecord {
  const event: DetectorDebugEvent = {
    eventType: "detector-state",
    at: Date.now(),
    phase: message.phase,
    rawClassification: message.rawClassification,
    stableClassification: message.stableClassification,
    reason: message.reason,
    decision: decision.action,
    decisionReason: decision.reason,
    mutedByExtension: Boolean(record.mutedByExtension),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource,
    signals: message.signals
  };

  console.debug("Ad Muter for MLB.TV transition", event);

  return {
    ...record,
    lastDecision: decision.action,
    debugHistory: appendDebugEvent(previous, event)
  };
}

export function recordMuteChange(
  record: TabSessionRecord,
  mutedInfo: chrome.tabs.MutedInfo,
  runtimeId: string
): TabSessionRecord {
  const muteSource = classifyMuteSource(mutedInfo, runtimeId);
  const event: MuteChangeDebugEvent = {
    eventType: "tab-mute-change",
    at: Date.now(),
    tabMuted: Boolean(mutedInfo.muted),
    muteSource,
    stableClassification: record.stableClassification || "unknown"
  };

  console.debug("Ad Muter for MLB.TV tab audio change", event);

  return {
    ...record,
    tabMuted: event.tabMuted,
    muteSource,
    mutedByExtension:
      muteSource === "this-extension" && event.tabMuted,
    manualAdOverride: Boolean(record.manualAdOverride) || (
      !event.tabMuted &&
      muteSource !== "this-extension" &&
      record.stableClassification === "ad"
    ),
    updatedAt: event.at,
    debugHistory: appendDebugEvent(record, event)
  };
}

export function recordMuteRepair(
  record: TabSessionRecord
): TabSessionRecord {
  const event: ReconciliationDebugEvent = {
    eventType: "mute-reconciliation",
    at: Date.now(),
    stableClassification: record.stableClassification,
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Ad Muter for MLB.TV repaired tab audio state", event);

  return {
    ...record,
    debugHistory: appendDebugEvent(record, event)
  };
}

export function recordNavigation(
  record: TabSessionRecord,
  decision: NavigationDecision
): TabSessionRecord {
  const event: NavigationDebugEvent = {
    eventType: "navigation",
    at: Date.now(),
    decision,
    adMuteLatched: Boolean(record.adMuteLatched),
    mutedByExtension: Boolean(record.mutedByExtension),
    tabMuted: record.tabMuted,
    muteSource: record.muteSource
  };

  console.debug("Ad Muter for MLB.TV navigation audio policy", event);

  return {
    ...record,
    lastDecision: decision,
    debugHistory: appendDebugEvent(record, event)
  };
}
