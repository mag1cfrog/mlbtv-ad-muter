import type {
  DetectorErrorMessage,
  DetectorStateMessage
} from "./shared/types.ts";
import { initializeSettings } from "./shared/settings.ts";
import { sessionKey } from "./shared/tab-session.ts";
import { RELEASE_RETRY_PREFIX } from "./background/tab-audio.ts";
import { queueTabTask } from "./background/tab-queue.ts";
import {
  handleDetectorState,
  handleMuteInfoChange,
  handleNavigation,
  releaseAllExtensionMutes,
  retryMuteRelease
} from "./background/controller.ts";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(RELEASE_RETRY_PREFIX)) {
    return;
  }
  const tabId = Number(alarm.name.slice(RELEASE_RETRY_PREFIX.length));
  if (Number.isInteger(tabId)) {
    queueTabTask(tabId, () => retryMuteRelease(tabId)).catch(console.error);
  }
});

chrome.runtime.onInstalled.addListener(initializeSettings);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const runtimeMessage = message as DetectorStateMessage;
  const senderTabId = sender.tab?.id;

  if (
    runtimeMessage?.type === "detector-state" &&
    typeof senderTabId === "number"
  ) {
    queueTabTask(senderTabId, () => handleDetectorState(senderTabId, runtimeMessage))
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error(error);
        sendResponse({
          type: "detector-error",
          error: error instanceof Error ? error.message : String(error)
        } satisfies DetectorErrorMessage);
      });
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    changes.enabled &&
    changes.enabled.newValue === false
  ) {
    releaseAllExtensionMutes().catch(console.error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const mutedInfo = changeInfo.mutedInfo;

  if (mutedInfo) {
    queueTabTask(
      tabId,
      () => handleMuteInfoChange(tabId, mutedInfo)
    ).catch(console.error);
  }

  if (changeInfo.status === "loading") {
    queueTabTask(
      tabId,
      () => handleNavigation(tabId, changeInfo.url)
    ).catch(() => {
      // A missing or inaccessible tab needs no cleanup.
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueTabTask(
    tabId,
    async () => {
      await chrome.storage.session.remove(sessionKey(tabId));
      await chrome.alarms.clear(`${RELEASE_RETRY_PREFIX}${tabId}`);
    }
  ).catch(() => {});
});
