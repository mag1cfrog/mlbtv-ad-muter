import type {
  DetectorStateMessage,
  DetectorStateRequest,
  TabSessionRecord
} from "../shared/types.ts";
import { getTabRecord } from "../shared/tab-session.ts";

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

export async function readTabState(
  tabId: number,
  tabMuted?: boolean
): Promise<TabSessionRecord> {
  let record = await getTabRecord(tabId);
  try {
    // Use the same snapshot as the overlay, even before background storage catches up.
    const liveState = await chrome.tabs.sendMessage(tabId, {
      type: "get-detector-state"
    } satisfies DetectorStateRequest) as DetectorStateMessage | undefined;
    if (liveState?.type === "detector-state") {
      const { type: _type, ...detection } = liveState;
      record = { ...record, ...detection };
    }
  } catch {
    // Tabs outside the supported player do not have a content monitor.
  }
  return { ...record, tabMuted: tabMuted ?? record.tabMuted };
}
