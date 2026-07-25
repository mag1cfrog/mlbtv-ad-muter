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

test("retries ad muting and renders unavailable video audio", async () => {
  const detectorMessages: DetectorStateMessage[] = [];
  const overlayDetails = { textContent: "" };
  const overlayHost: {
    dataset: Record<string, string>;
    isConnected: boolean;
    parentNode: object | null;
    attachShadow: () => {
      querySelector: (selector: string) => object;
    };
    remove: () => void;
  } = {
    dataset: {},
    isConnected: false,
    parentNode: null,
    attachShadow() {
      const status = { dataset: {} };
      const label = { textContent: "" };

      return {
        querySelector(selector: string) {
          if (selector === ".status") {
            return status;
          }
          if (selector === "strong") {
            return label;
          }
          return overlayDetails;
        }
      };
    },
    remove() {
      this.isConnected = false;
      this.parentNode = null;
    }
  };
  const observer = {
    disconnect() {},
    observe() {}
  };
  const documentRoot = {
    documentElement: {
      appendChild(element: typeof overlayHost) {
        element.isConnected = true;
        element.parentNode = this;
      }
    },
    fullscreenElement: null,
    webkitFullscreenElement: null,
    addEventListener() {},
    createElement() {
      return overlayHost;
    },
    querySelector() {
      return null;
    }
  };
  const context = vm.createContext({
    MlbTvAdMuterDetector: {
      SELECTORS: {
        player: ".player",
        fallbackPlayer: "video"
      },
      inspect() {
        return {
          classification: "ad",
          confidence: 1,
          reason: "explicit-ad-controls-marker-present",
          signals: {
            playerMuted: null
          }
        };
      }
    },
    MlbTvAdMuterOverlayPolicy: {
      DEFAULT_POSITION: "bottom-right",
      getMountTarget() {
        return documentRoot.documentElement;
      },
      normalizePosition(position: OverlayPosition | undefined) {
        return position || "bottom-right";
      }
    },
    MlbTvAdMuterTimingPolicy: {
      TIMING_MS: {
        debounce: 1,
        watchdog: 1500
      },
      confirmationDelayFor() {
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
        sendMessage(message: DetectorStateMessage) {
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
              showOverlay: true,
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
  assert.match(overlayDetails.textContent, /video: unavailable/);
});
