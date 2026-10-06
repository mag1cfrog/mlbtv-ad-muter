import type { TabSessionRecord } from "../shared/types.ts";
import { classifyMuteSource, describeTabMuteState } from "./mute-policy.ts";

export const RELEASE_RETRY_PREFIX = "release-mute:";

export async function getTabMuteState(
  tabId: number
): Promise<Pick<TabSessionRecord, "tabMuted" | "muteSource">> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      tabMuted: Boolean(tab.mutedInfo?.muted),
      muteSource: classifyMuteSource(
        tab.mutedInfo,
        chrome.runtime.id
      )
    };
  } catch {
    return {
      tabMuted: null,
      muteSource: "unavailable"
    };
  }
}

export async function ensureMuted(
  tabId: number,
  record: TabSessionRecord
): Promise<TabSessionRecord> {
  const tab = await chrome.tabs.get(tabId);
  const actualState = describeTabMuteState(
    tab.mutedInfo,
    chrome.runtime.id
  );

  if (actualState.tabMuted) {
    await chrome.alarms.clear(`${RELEASE_RETRY_PREFIX}${tabId}`);
    return {
      ...record,
      ...actualState
    };
  }

  await chrome.tabs.update(tabId, { muted: true });
  await chrome.alarms.clear(`${RELEASE_RETRY_PREFIX}${tabId}`);
  return {
    ...record,
    mutedByExtension: true
  };
}

export async function releaseMute(
  tabId: number,
  record: TabSessionRecord
): Promise<TabSessionRecord> {
  if (!record.mutedByExtension) {
    await chrome.alarms.clear(`${RELEASE_RETRY_PREFIX}${tabId}`);
    return {
      ...record,
      mutedByExtension: false
    };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const mutedByThisExtension =
      tab.mutedInfo?.muted &&
      tab.mutedInfo.reason === "extension" &&
      tab.mutedInfo.extensionId === chrome.runtime.id;

    if (mutedByThisExtension) {
      await chrome.tabs.update(tabId, { muted: false });
    }
  } catch (error) {
    // Browser alarms survive an idle unload, including after the player is gone.
    await chrome.alarms.create(`${RELEASE_RETRY_PREFIX}${tabId}`, {
      periodInMinutes: 1
    });
    throw error;
  }

  await chrome.alarms.clear(`${RELEASE_RETRY_PREFIX}${tabId}`);
  return {
    ...record,
    mutedByExtension: false
  };
}
