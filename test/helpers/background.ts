import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import type {
  DetectorResponse,
  DetectorStateMessage,
  ExtensionSettings,
  PlayerClassification,
  TabSessionRecord
} from "../../src/shared/types.ts";
import { flush } from "./clock.ts";

export type TestDetectorResponse = Exclude<DetectorResponse, undefined>;
type MessageListener = (
  message: DetectorStateMessage,
  sender: { tab?: { id?: number } },
  sendResponse: (response: TestDetectorResponse) => void
) => boolean;
type TestListeners = Partial<{
  alarm: (alarm: { name: string }) => void;
  installed: () => void;
  message: MessageListener;
  storageChanged: (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string
  ) => void;
  tabRemoved: (tabId: number) => void;
  tabUpdated: (tabId: number, changeInfo: object) => void;
}>;
type MuteBarrier = {
  release: Promise<void>;
  started: () => void;
};

function detectorState(
  classification: PlayerClassification
): DetectorStateMessage {
  const isAd = classification === "ad";

  return {
    type: "detector-state",
    phase: "stable",
    stableClassification: classification,
    rawClassification: classification,
    confidence: 1,
    reason: isAd
      ? "explicit-ad-controls-marker-present"
      : "rich-playback-controls-present",
    signals: {
      hasPlayer: true,
      hasVideo: true,
      playerMuted: false,
      hasAdControls: isAd,
      hasPlayPause: true,
      hasVolume: true,
      hasRewind: !isAd,
      hasFastForward: !isAd,
      hasSeekSlider: !isAd,
      hasLivePoint: !isAd,
      hasBroadcast: !isAd,
      hasQuality: !isAd,
      hasFullscreen: !isAd
    }
  };
}

export function loadBackground(buildDirectory: string) {
  const tabId = 7;
  const runtimeId = "test-extension";
  const session: Record<string, TabSessionRecord> = {};
  const tabMessages: unknown[] = [];
  const tabUpdates: boolean[] = [];
  const listeners: TestListeners = {};
  const alarms = new Map<string, { periodInMinutes: number }>();
  let muteBarrier: MuteBarrier | null = null;
  let nextTabGetError: Error | null = null;
  let nextTabUpdateError: Error | null = null;
  const settings: {
    enabled: boolean;
    showOverlay: boolean;
    overlayPosition: ExtensionSettings["overlayPosition"];
  } = {
    enabled: true,
    showOverlay: false,
    overlayPosition: "bottom-right"
  } satisfies ExtensionSettings;
  const tab: {
    id: number;
    url: string;
    mutedInfo: chrome.tabs.MutedInfo;
  } = {
    id: tabId,
    url: "https://www.mlb.com/tv/game",
    mutedInfo: {
      muted: false
    }
  };

  const chrome = {
    alarms: {
      async create(name: string, alarmInfo: { periodInMinutes: number }) {
        alarms.set(name, alarmInfo);
      },
      async clear(name: string) {
        return alarms.delete(name);
      },
      onAlarm: {
        addListener(listener: NonNullable<TestListeners["alarm"]>) {
          listeners.alarm = listener;
        }
      }
    },
    action: {
      async setBadgeBackgroundColor(
        { tabId: badgeTabId }: { tabId: number }
      ) {
        if (badgeTabId === 99) {
          throw new Error("No tab with id: 99");
        }
      },
      async setBadgeText() {}
    },
    runtime: {
      id: runtimeId,
      onInstalled: {
        addListener(listener: () => void) {
          listeners.installed = listener;
        }
      },
      onMessage: {
        addListener(listener: MessageListener) {
          listeners.message = listener;
        }
      }
    },
    storage: {
      local: {
        async get(defaults: ExtensionSettings) {
          return {
            ...defaults,
            ...settings
          };
        },
        async set(values: Partial<ExtensionSettings>) {
          Object.assign(settings, values);
        }
      },
      session: {
        async get(key: string | undefined) {
          if (key === undefined) {
            return { ...session };
          }

          return Object.hasOwn(session, key)
            ? { [key]: session[key] }
            : {};
        },
        async remove(key: string) {
          delete session[key];
        },
        async set(values: Record<string, TabSessionRecord>) {
          Object.assign(session, values);
        }
      },
      onChanged: {
        addListener(listener: NonNullable<TestListeners["storageChanged"]>) {
          listeners.storageChanged = listener;
        }
      }
    },
    tabs: {
      async query() {
        return [tab];
      },
      async get(requestedTabId: number) {
        assert.equal(requestedTabId, tabId);
        if (nextTabGetError) {
          const error = nextTabGetError;
          nextTabGetError = null;
          throw error;
        }
        return tab;
      },
      async sendMessage(
        requestedTabId: number,
        message: unknown
      ) {
        assert.equal(requestedTabId, tabId);
        tabMessages.push(message);
      },
      async update(
        requestedTabId: number,
        update: { muted: boolean }
      ) {
        assert.equal(requestedTabId, tabId);

        if (nextTabUpdateError) {
          const error = nextTabUpdateError;
          nextTabUpdateError = null;
          throw error;
        }

        if (update.muted && muteBarrier) {
          const barrier = muteBarrier;
          muteBarrier = null;
          barrier.started();
          await barrier.release;
        }

        tabUpdates.push(update.muted);
        tab.mutedInfo = {
          muted: update.muted,
          reason: "extension",
          extensionId: runtimeId
        };
        return tab;
      },
      onRemoved: {
        addListener(listener: NonNullable<TestListeners["tabRemoved"]>) {
          listeners.tabRemoved = listener;
        }
      },
      onUpdated: {
        addListener(listener: NonNullable<TestListeners["tabUpdated"]>) {
          listeners.tabUpdated = listener;
        }
      }
    }
  };

  function startBackground(): void {
    const extensionRoot = path.join(import.meta.dirname, "../..", buildDirectory);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8")
    ) as { background: { service_worker?: string; scripts?: string[] } };
    const context = vm.createContext({
      URL,
      chrome,
      console: {
        debug() {},
        error() {}
      }
    });

    function runScript(file: string): void {
      vm.runInContext(
        fs.readFileSync(path.join(extensionRoot, file), "utf8"),
        context,
        { filename: file }
      );
    }

    const worker = manifest.background.service_worker;
    if (worker) {
      runScript(worker);
    } else {
      assert.ok(manifest.background.scripts?.length);
      for (const script of manifest.background.scripts!) {
        runScript(script);
      }
    }
  }

  startBackground();

  function sendDetectorState(classification: PlayerClassification) {
    return new Promise<TestDetectorResponse>((resolve) => {
      const keepChannelOpen = listeners.message!(
        detectorState(classification),
        { tab: { id: tabId } },
        resolve
      );

      assert.equal(keepChannelOpen, true);
    });
  }

  async function emitTabUpdate(changeInfo: object) {
    listeners.tabUpdated!(tabId, changeInfo);
    await flush();
  }

  async function emitReleaseRetry(retryTabId = tabId) {
    assert.ok(listeners.alarm, "The release retry listener must be registered.");
    listeners.alarm!({ name: `release-mute:${retryTabId}` });
    await flush();
  }

  return {
    tabId,
    runtimeId,
    session,
    tabMessages,
    tabUpdates,
    listeners,
    alarms,
    settings,
    tab,
    startBackground,
    sendDetectorState,
    emitTabUpdate,
    emitReleaseRetry,
    failNextTabGet(error: Error) {
      nextTabGetError = error;
    },
    failNextTabUpdate(error: Error) {
      nextTabUpdateError = error;
    },
    blockNextMute(barrier: MuteBarrier) {
      muteBarrier = barrier;
    }
  };
}
