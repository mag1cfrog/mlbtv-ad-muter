import fs from "node:fs";
import vm from "node:vm";
import { SELECTORS } from "../../src/content/detector.ts";
import type {
  DetectorRefreshMessage,
  DetectorResponse,
  DetectorStateMessage,
  DetectorStateRequest,
  TabAudioStateMessage
} from "../../src/shared/types.ts";
import { createClock, flush } from "./clock.ts";

type RuntimeMessageListener = (
  message: DetectorRefreshMessage | DetectorStateRequest | TabAudioStateMessage,
  sender?: object,
  respond?: (state: DetectorStateMessage | undefined) => void
) => boolean;

type OverlayHost = {
  dataset: Record<string, string>;
  isConnected: boolean;
  parentNode: object | null;
  attachShadow(): { innerHTML: string; querySelector(selector: string): object };
  remove(): void;
};

const contentSource = fs.readFileSync(
  new URL("../../dist/src/content.js", import.meta.url),
  "utf8"
);

export async function loadContent({
  initialState = "content",
  explicitAd = false,
  showOverlay = false,
  respond
}: {
  initialState?: "ad" | "content";
  explicitAd?: boolean;
  showOverlay?: boolean;
  respond?: (message: DetectorStateMessage) => DetectorResponse;
} = {}) {
  const clock = createClock();
  const messages: DetectorStateMessage[] = [];
  const observerCallbacks: Array<() => void> = [];
  const observedTargets: object[] = [];
  const documentListeners = new Map<string, () => void>();
  let runtimeListener: RuntimeMessageListener | undefined;
  let videoPresent = true;
  let tabMuted = false;
  let visibleControls = new Set<string>();
  const video = { muted: false };
  const playerWrapper = {};
  const createPlayer = () => ({
    closest() {
      return playerWrapper;
    },
    querySelector(selector: string) {
      if (selector === SELECTORS.video) {
        return videoPresent ? video : null;
      }
      return visibleControls.has(selector) ? {} : null;
    }
  });
  let player = createPlayer();

  function showControls(classification: "ad" | "content", explicitMarker = false) {
    visibleControls = new Set([SELECTORS.pause, SELECTORS.mute]);
    if (classification === "content") {
      visibleControls.add(SELECTORS.rewind);
      visibleControls.add(SELECTORS.fastForward);
      visibleControls.add(SELECTORS.seekSlider);
      visibleControls.add(SELECTORS.livePoint);
    } else if (explicitMarker) {
      visibleControls.add(SELECTORS.adControls);
    }
  }
  showControls(initialState, explicitAd);

  const status = { dataset: {} as Record<string, string> };
  const label = { textContent: "" };
  const details = { textContent: "" };
  const style = { textContent: "" };
  const shadow = {
    innerHTML: "",
    appendChild() {},
    querySelector(selector: string) {
      return selector === ".status" ? status : selector === "strong" ? label : details;
    }
  };
  const host: OverlayHost = {
    dataset: {},
    isConnected: false,
    parentNode: null,
    attachShadow() {
      return shadow;
    },
    remove() {
      this.isConnected = false;
      this.parentNode = null;
    }
  };
  const createMountTarget = () => ({
    appendChild(element: OverlayHost) {
      element.isConnected = true;
      element.parentNode = this;
    }
  });
  const document = {
    documentElement: createMountTarget(),
    fullscreenElement: null as object | null,
    webkitFullscreenElement: null,
    addEventListener(name: string, callback: () => void) {
      documentListeners.set(name, callback);
    },
    createElement(tagName: string) {
      return tagName === "style" ? style : host;
    },
    querySelector(selector: string) {
      return selector === SELECTORS.player || selector === SELECTORS.fallbackPlayer
        ? player
        : null;
    }
  };
  const context = vm.createContext({
    ...clock.browserTimers,
    document,
    console,
    MutationObserver: class {
      constructor(callback: () => void) {
        observerCallbacks.push(callback);
      }
      disconnect() {}
      observe(target: object) {
        observedTargets.push(target);
      }
    },
    chrome: {
      runtime: {
        getManifest() {
          return { version: "0.2.4" };
        },
        onMessage: {
          addListener(listener: RuntimeMessageListener) {
            runtimeListener = listener;
          }
        },
        sendMessage(message: DetectorStateMessage) {
          messages.push(message);
          if (respond) {
            return Promise.resolve(respond(message));
          }
          if (message.stableClassification === "ad") {
            tabMuted = true;
          } else if (message.phase === "stable" && message.stableClassification === "content") {
            tabMuted = false;
          }
          return Promise.resolve({
            type: "tab-audio-state",
            enabled: true,
            tabMuted,
            manualAdOverride: false,
            muteSource: "this-extension"
          });
        }
      },
      storage: {
        local: {
          async get() {
            return { enabled: true, showOverlay, overlayPosition: "bottom-right" };
          }
        },
        onChanged: { addListener() {} }
      }
    }
  });

  vm.runInContext(contentSource, context);
  await flush();
  if (!runtimeListener) {
    throw new Error("Missing content message listener.");
  }
  const send = runtimeListener;
  return {
    clock,
    messages,
    observedTargets,
    playerWrapper,
    overlay: { host, status, label, details, shadow, style },
    showControls,
    mutate() {
      observerCallbacks[0]();
    },
    replacePlayer() {
      player = createPlayer();
      observerCallbacks[0]();
    },
    removeVideo() {
      videoPresent = false;
      observerCallbacks[0]();
    },
    enterFullscreen() {
      document.fullscreenElement = createMountTarget();
      documentListeners.get("fullscreenchange")!();
      return document.fullscreenElement;
    },
    async requestRefresh() {
      send({ type: "refresh-detector-state" });
      await flush();
    },
    getSnapshot() {
      let snapshot: DetectorStateMessage | undefined;
      send({ type: "get-detector-state" }, {}, (state) => {
        snapshot = state;
      });
      return snapshot;
    }
  };
}
