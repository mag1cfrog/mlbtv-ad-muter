"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "..", "dist", "src", "background.js"),
  "utf8"
);
const mutePolicy =
  require("../dist/src/mute-policy.js") as MutePolicy;
const overlayPolicy =
  require("../dist/src/overlay-policy.js") as OverlayPolicy;

type TestDetectorResponse = Exclude<DetectorResponse, undefined>;
type MessageListener = (
  message: DetectorStateMessage,
  sender: { tab?: { id?: number } },
  sendResponse: (response: TestDetectorResponse) => void
) => boolean;
type TestListeners = Partial<{
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

test("coordinates mute lifecycle, global release, and tab cleanup", async () => {
  const tabId = 7;
  const runtimeId = "test-extension";
  const session: Record<string, TabSessionRecord> = {};
  const tabMessages: unknown[] = [];
  const tabUpdates: boolean[] = [];
  const listeners: TestListeners = {};
  let muteBarrier: MuteBarrier | null = null;
  let nextTabUpdateError: Error | null = null;
  const settings: {
    enabled: boolean;
    showOverlay: boolean;
    overlayPosition: OverlayPosition;
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
      async get(requestedTabId: number) {
        assert.equal(requestedTabId, tabId);
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

  vm.runInContext(
    backgroundSource,
    vm.createContext({
      MlbTvAdMuterMutePolicy: mutePolicy,
      MlbTvAdMuterOverlayPolicy: overlayPolicy,
      URL,
      chrome,
      console: {
        debug() {},
        error() {}
      },
      importScripts() {}
    })
  );

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
    await new Promise((resolve) => setImmediate(resolve));
  }

  function assertAudioState(
    value: TestDetectorResponse
  ): asserts value is TabAudioStateMessage {
    assert.equal(value.type, "tab-audio-state");
  }

  tab.mutedInfo = {
    muted: true,
    reason: "user"
  };
  let response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(response.muteSource, "user");

  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(response.muteSource, "user");
  assert.deepEqual(tabUpdates, []);

  tab.mutedInfo = {
    muted: false
  };
  nextTabUpdateError = new Error("Simulated tab update failure");
  response = await sendDetectorState("ad");
  assert.equal(response.type, "detector-error");
  assert.equal("error" in response, true);
  if (!("error" in response)) {
    throw new Error("Expected a detector error response.");
  }
  assert.match(response.error, /Simulated tab update failure/);

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(tab.mutedInfo.extensionId, runtimeId);

  const userUnmute = {
    muted: false,
    reason: "user"
  } satisfies chrome.tabs.MutedInfo;
  tab.mutedInfo = userUnmute;
  await emitTabUpdate({ mutedInfo: userUnmute });

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, false);
  assert.equal(response.manualAdOverride, true);

  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.manualAdOverride, false);

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);

  tabMessages.length = 0;
  await emitTabUpdate({
    status: "loading",
    url: tab.url
  });
  assert.equal(session[`tab:${tabId}`]?.stableClassification, "unknown");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(
    tabMessages.some(
      (message) =>
        (message as DetectorRefreshMessage).type ===
        "refresh-detector-state"
    ),
    true
  );

  response = await sendDetectorState("ad");
  assertAudioState(response);

  const unsupportedUrl = "https://example.com/";
  tab.url = unsupportedUrl;
  await emitTabUpdate({
    status: "loading",
    url: unsupportedUrl
  });

  assert.equal(tab.mutedInfo.muted, false);
  assert.deepEqual(tabUpdates, [true, true, false]);
  assert.equal(session[`tab:${tabId}`]?.stableClassification, "unknown");
  assert.equal(
    session[`tab:${tabId}`]?.lastDecision,
    "release-navigation-mute"
  );

  for (let index = 0; index < 40; index += 1) {
    await sendDetectorState("content");
  }

  assert.equal(session[`tab:${tabId}`]?.debugHistory?.length, 40);

  const validKey = `tab:${tabId}`;
  const validRecord = session[validKey];
  assert.ok(validRecord);
  delete session[validKey];
  session["tab:99"] = { mutedByExtension: true };
  session[validKey] = validRecord;

  const blockedMute = Promise.withResolvers<void>();
  const muteStarted = Promise.withResolvers<void>();
  muteBarrier = {
    release: blockedMute.promise,
    started: () => muteStarted.resolve()
  };

  const pendingAd = sendDetectorState("ad");
  await muteStarted.promise;

  settings.enabled = false;
  listeners.storageChanged!(
    { enabled: { newValue: false } },
    "local"
  );
  blockedMute.resolve();
  await pendingAd;

  for (let attempt = 0; attempt < 10 && tab.mutedInfo.muted; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(tab.mutedInfo.muted, false);
  assert.deepEqual(tabUpdates.slice(-2), [true, false]);

  settings.enabled = true;
  const removalBlockedMute = Promise.withResolvers<void>();
  const removalMuteStarted = Promise.withResolvers<void>();
  muteBarrier = {
    release: removalBlockedMute.promise,
    started: () => removalMuteStarted.resolve()
  };

  const pendingRemovedTabAd = sendDetectorState("ad");
  await removalMuteStarted.promise;
  listeners.tabRemoved!(tabId);
  removalBlockedMute.resolve();
  await pendingRemovedTabAd;

  for (
    let attempt = 0;
    attempt < 10 && Object.hasOwn(session, validKey);
    attempt += 1
  ) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(Object.hasOwn(session, validKey), false);
});
