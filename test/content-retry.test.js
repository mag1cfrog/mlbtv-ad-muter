"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "dist", "src", "content.js"),
  "utf8"
);

test("retries a stable ad state until tab mute is acknowledged", async () => {
  const detectorMessages = [];
  const observer = {
    disconnect() {},
    observe() {}
  };
  const documentRoot = {
    documentElement: {},
    fullscreenElement: null,
    webkitFullscreenElement: null,
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  const context = vm.createContext({
    BaseballBreakDetector: {
      SELECTORS: {
        player: ".player",
        fallbackPlayer: "video"
      },
      inspect() {
        return {
          classification: "ad",
          confidence: "high",
          reason: "explicit-ad-controls-marker-present",
          signals: {
            playerMuted: false
          }
        };
      }
    },
    BaseballBreakOverlayPolicy: {
      DEFAULT_POSITION: "bottom-right",
      getMountTarget() {
        return documentRoot.documentElement;
      },
      normalizePosition(position) {
        return position || "bottom-right";
      }
    },
    BaseballBreakTimingPolicy: {
      TIMING_MS: {
        debounce: 1,
        watchdog: 1500
      },
      holdFor() {
        return 0;
      },
      muteRetryDelay() {
        return 10;
      }
    },
    MutationObserver: class {
      disconnect() {
        observer.disconnect();
      }

      observe() {
        observer.observe();
      }
    },
    chrome: {
      runtime: {
        getManifest() {
          return {
            version: "0.1.9"
          };
        },
        onMessage: {
          addListener() {}
        },
        sendMessage(message) {
          detectorMessages.push(message);
          const acknowledged = detectorMessages.length >= 2;

          return Promise.resolve({
            type: "tab-audio-state",
            enabled: true,
            tabMuted: acknowledged,
            manualAdOverride: false,
            muteSource: acknowledged ? "this-extension" : "unknown"
          });
        }
      },
      storage: {
        local: {
          get() {
            return Promise.resolve({
              enabled: true,
              showOverlay: false,
              overlayPosition: "bottom-right"
            });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    },
    clearInterval() {},
    clearTimeout,
    console,
    document: documentRoot,
    setInterval() {
      return 1;
    },
    setTimeout
  });

  vm.runInContext(contentSource, context);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(detectorMessages.length, 2);
  assert.equal(detectorMessages[0].stableClassification, "ad");
  assert.equal(detectorMessages[1].stableClassification, "ad");
});
