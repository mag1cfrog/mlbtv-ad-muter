"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

type TestDetectorResponse = Exclude<DetectorResponse, undefined>;
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

async function exerciseMuteLifecycle(buildDirectory: string): Promise<void> {
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
    const extensionRoot = path.join(__dirname, "..", buildDirectory);
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
      context.importScripts = (...urls: string[]) => {
        for (const url of urls) {
          runScript(path.posix.join(path.posix.dirname(worker), url));
        }
      };
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
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function emitReleaseRetry(retryTabId = tabId) {
    assert.ok(listeners.alarm, "The release retry listener must be registered.");
    listeners.alarm!({ name: `release-mute:${retryTabId}` });
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

  // Both browsers can unload the background context between events.
  startBackground();
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

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  nextTabGetError = new Error("Simulated tab lookup failure");
  response = await sendDetectorState("content");
  assert.equal(response.type, "detector-error");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  nextTabUpdateError = new Error("Simulated unmute failure");
  response = await sendDetectorState("content");
  assert.equal(response.type, "detector-error");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  // A failed release must remain retryable across a background restart.
  startBackground();
  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.tabMuted, false);
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);

  await sendDetectorState("ad");
  nextTabUpdateError = new Error("Simulated navigation unmute failure");
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  assert.equal(alarms.get(`release-mute:${tabId}`)?.periodInMinutes, 1);
  startBackground();
  nextTabUpdateError = new Error("Simulated repeated unmute failure");
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(alarms.has(`release-mute:${tabId}`), true);

  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  nextTabUpdateError = new Error("Simulated navigation unmute failure");
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  tab.url = "https://www.mlb.com/tv/another-game";
  const updatesBeforeRetry = tabUpdates.length;
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(tabUpdates.length, updatesBeforeRetry);
  assert.equal(
    (tabMessages.at(-1) as DetectorRefreshMessage).type,
    "refresh-detector-state"
  );
  await sendDetectorState("ad");
  assert.equal(alarms.has(`release-mute:${tabId}`), false);

  nextTabUpdateError = new Error("Simulated navigation unmute failure");
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  tab.mutedInfo = { muted: true, reason: "user" };
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(tabUpdates.length, updatesBeforeRetry);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
  tab.mutedInfo = { muted: false };

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  nextTabUpdateError = new Error("Simulated disable unmute failure");
  settings.enabled = false;
  listeners.storageChanged!({ enabled: { newValue: false } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
  settings.enabled = true;

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

  assert.equal(alarms.has("release-mute:99"), true);
  await emitReleaseRetry(99);
  assert.equal(alarms.has("release-mute:99"), false);
  assert.equal(Object.hasOwn(session, "tab:99"), false);

  settings.enabled = true;
  const removalBlockedMute = Promise.withResolvers<void>();
  const removalMuteStarted = Promise.withResolvers<void>();
  muteBarrier = {
    release: removalBlockedMute.promise,
    started: () => removalMuteStarted.resolve()
  };

  const pendingRemovedTabAd = sendDetectorState("ad");
  await removalMuteStarted.promise;
  nextTabUpdateError = new Error("Simulated unmute failure before tab closure");
  const pendingRemovedTabRelease = sendDetectorState("content");
  listeners.tabRemoved!(tabId);
  removalBlockedMute.resolve();
  await pendingRemovedTabAd;
  assert.equal((await pendingRemovedTabRelease).type, "detector-error");

  for (
    let attempt = 0;
    attempt < 10 && (
      Object.hasOwn(session, validKey) ||
      alarms.has(`release-mute:${tabId}`)
    );
    attempt += 1
  ) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(Object.hasOwn(session, validKey), false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
}

for (const buildDirectory of ["dist", "dist-firefox"]) {
  test(`${buildDirectory}: mute lifecycle, background restart, and cleanup`, () =>
    exerciseMuteLifecycle(buildDirectory)
  );
}
