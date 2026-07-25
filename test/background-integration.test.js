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
const mutePolicy = require("../dist/src/mute-policy.js");
const overlayPolicy = require("../dist/src/overlay-policy.js");

function detectorState(classification) {
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

test("coordinates ad muting, manual override, and navigation release", async () => {
  const tabId = 7;
  const runtimeId = "test-extension";
  const session = {};
  const tabUpdates = [];
  const listeners = {};
  const settings = {
    enabled: true,
    showOverlay: false,
    overlayPosition: "bottom-right"
  };
  const tab = {
    id: tabId,
    url: "https://www.mlb.com/tv/game",
    mutedInfo: {
      muted: false
    }
  };

  const chrome = {
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {}
    },
    runtime: {
      id: runtimeId,
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        }
      },
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        }
      }
    },
    storage: {
      local: {
        async get(defaults) {
          return {
            ...defaults,
            ...settings
          };
        },
        async set(values) {
          Object.assign(settings, values);
        }
      },
      session: {
        async get(key) {
          if (key === undefined) {
            return { ...session };
          }

          return Object.hasOwn(session, key)
            ? { [key]: session[key] }
            : {};
        },
        async remove(key) {
          delete session[key];
        },
        async set(values) {
          Object.assign(session, values);
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.storageChanged = listener;
        }
      }
    },
    tabs: {
      async get(requestedTabId) {
        assert.equal(requestedTabId, tabId);
        return tab;
      },
      async sendMessage() {},
      async update(requestedTabId, update) {
        assert.equal(requestedTabId, tabId);
        tabUpdates.push(update.muted);
        tab.mutedInfo = {
          muted: update.muted,
          reason: "extension",
          extensionId: runtimeId
        };
        return tab;
      },
      onRemoved: {
        addListener(listener) {
          listeners.tabRemoved = listener;
        }
      },
      onUpdated: {
        addListener(listener) {
          listeners.tabUpdated = listener;
        }
      }
    }
  };

  vm.runInContext(
    backgroundSource,
    vm.createContext({
      BaseballBreakMutePolicy: mutePolicy,
      BaseballBreakOverlayPolicy: overlayPolicy,
      URL,
      chrome,
      console: {
        debug() {},
        error() {}
      },
      importScripts() {}
    })
  );

  function sendDetectorState(classification) {
    return new Promise((resolve) => {
      const keepChannelOpen = listeners.message(
        detectorState(classification),
        { tab: { id: tabId } },
        resolve
      );

      assert.equal(keepChannelOpen, true);
    });
  }

  async function emitTabUpdate(changeInfo) {
    listeners.tabUpdated(tabId, changeInfo);
    await new Promise((resolve) => setImmediate(resolve));
  }

  let response = await sendDetectorState("ad");
  assert.equal(response.tabMuted, true);
  assert.equal(tab.mutedInfo.extensionId, runtimeId);

  const userUnmute = {
    muted: false,
    reason: "user"
  };
  tab.mutedInfo = userUnmute;
  await emitTabUpdate({ mutedInfo: userUnmute });

  response = await sendDetectorState("ad");
  assert.equal(response.tabMuted, false);
  assert.equal(response.manualAdOverride, true);

  response = await sendDetectorState("content");
  assert.equal(response.manualAdOverride, false);

  response = await sendDetectorState("ad");
  assert.equal(response.tabMuted, true);

  const unsupportedUrl = "https://example.com/";
  tab.url = unsupportedUrl;
  await emitTabUpdate({
    status: "loading",
    url: unsupportedUrl
  });

  assert.equal(tab.mutedInfo.muted, false);
  assert.deepEqual(tabUpdates, [true, true, false]);
  assert.equal(session[`tab:${tabId}`].stableClassification, "unknown");
  assert.equal(
    session[`tab:${tabId}`].lastDecision,
    "release-navigation-mute"
  );
});
