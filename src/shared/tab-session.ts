import type { TabSessionRecord } from "./types.ts";

export function sessionKey(tabId: number): string {
  return `tab:${tabId}`;
}

export async function getTabRecord(tabId: number): Promise<TabSessionRecord> {
  const key = sessionKey(tabId);
  const values = await chrome.storage.session.get(key);
  return (values[key] as TabSessionRecord | undefined) ?? {};
}

export async function setTabRecord(
  tabId: number,
  record: TabSessionRecord
): Promise<void> {
  await chrome.storage.session.set({
    [sessionKey(tabId)]: record
  });
}
