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

function inspection(classification: PlayerClassification) {
  return {
    classification,
    confidence: 1,
    reason: classification === "ad"
      ? "explicit-ad-controls-marker-present"
      : "rich-playback-controls-present",
    signals: {
      playerMuted: false
    }
  };
}

test("confirms sustained transitions and ignores short flickers", async () => {
  let now = 0;
  let nextTimerId = 1;
  let currentClassification: PlayerClassification = "content";
  const detectorMessages: DetectorStateMessage[] = [];
  const observerCallbacks: Array<() => void> = [];
  const timers = new Map<number, {
    at: number;
    callback: () => void;
  }>();
  const documentRoot = {
    documentElement: {},
    fullscreenElement: null,
    webkitFullscreenElement: null,
    addEventListener() {},
    querySelector() {
      return null;
    }
  };

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function advance(milliseconds: number) {
    const target = now + milliseconds;

    while (timers.size) {
      const nextTimer = [...timers.entries()]
        .sort((left, right) => (
          left[1].at - right[1].at || left[0] - right[0]
        ))[0];

      if (nextTimer[1].at > target) {
        break;
      }

      timers.delete(nextTimer[0]);
      now = nextTimer[1].at;
      nextTimer[1].callback();
      await flushPromises();
    }

    now = target;
    await flushPromises();
  }

  const context = vm.createContext({
    MlbTvAdMuterDetector: {
      SELECTORS: {
        player: ".player",
        fallbackPlayer: "video"
      },
      inspect() {
        return inspection(currentClassification);
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
        debounce: 5,
        watchdog: 1500
      },
      confirmationDelayFor(
        { classification }: Pick<DetectorClassification, "classification">
      ) {
        return classification === "ad" ? 100 : 200;
      },
      muteRetryDelay() {
        return 50;
      }
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        observerCallbacks.push(callback);
      }

      disconnect() {}
      observe() {}
    },
    chrome: {
      runtime: {
        getManifest() {
          return {
            version: "0.1.10"
          };
        },
        onMessage: {
          addListener() {}
        },
        sendMessage(message: DetectorStateMessage) {
          detectorMessages.push(message);
          const muted =
            message.phase === "stable" &&
            message.stableClassification === "ad";

          return Promise.resolve({
            type: "tab-audio-state",
            enabled: true,
            tabMuted: muted,
            manualAdOverride: false,
            muteSource: muted ? "this-extension" : "unknown"
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
    clearTimeout(timerId: number) {
      timers.delete(timerId);
    },
    console,
    Date: FakeDate,
    document: documentRoot,
    setInterval() {
      return 1;
    },
    setTimeout(callback: () => void, delay = 0) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        at: now + delay,
        callback
      });
      return timerId;
    }
  });

  const stableCount = (classification: PlayerClassification) =>
    detectorMessages.filter(
    (message) => (
      message.phase === "stable" &&
      message.stableClassification === classification
    )
  ).length;
  const evaluateAfterMutation = () => observerCallbacks[0]();

  vm.runInContext(contentSource, context);
  await flushPromises();

  await advance(199);
  assert.equal(stableCount("content"), 0);
  await advance(1);
  assert.equal(stableCount("content"), 1);

  currentClassification = "ad";
  evaluateAfterMutation();
  await advance(5);
  await advance(50);
  currentClassification = "content";
  evaluateAfterMutation();
  await advance(5);
  assert.equal(stableCount("ad"), 0);

  currentClassification = "ad";
  evaluateAfterMutation();
  await advance(5);
  await advance(99);
  assert.equal(stableCount("ad"), 0);
  await advance(1);
  assert.equal(stableCount("ad"), 1);

  const contentCountBeforeReturn = stableCount("content");
  currentClassification = "content";
  evaluateAfterMutation();
  await advance(5);
  await advance(199);
  assert.equal(stableCount("content"), contentCountBeforeReturn);
  await advance(1);
  assert.equal(stableCount("content"), contentCountBeforeReturn + 1);
});
