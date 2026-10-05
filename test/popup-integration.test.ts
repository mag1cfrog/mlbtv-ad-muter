"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const overlayPolicy = require("../dist/src/overlay-policy.js");

const popupSource = fs.readFileSync(
  path.join(__dirname, "..", "dist", "src", "popup.js"),
  "utf8"
);

const SELECTORS = [
  "#enabled",
  "#mode",
  "#show-overlay",
  "#overlay-mode",
  "#overlay-position",
  "#classification",
  "#reason",
  "#status-dot",
  "#diagnostic-log",
  "#copy-diagnostics",
  "#copy-status"
] as const;

type Selector = typeof SELECTORS[number];
type ElementListener = () => void | Promise<void>;
type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string
) => void;
type DetectorMessageListener = (
  message: DetectorStateMessage,
  sender: { tab: { id: number } }
) => boolean;
type TestElement = {
  checked: boolean;
  className: string;
  textContent: string;
  value: string;
  addEventListener: (type: string, listener: ElementListener) => void;
  dispatch: (type: string) => void | Promise<void>;
};

function createElement(): TestElement {
  const listeners = new Map<string, ElementListener>();

  return {
    checked: false,
    className: "",
    textContent: "",
    value: "",
    addEventListener(type: string, listener: ElementListener) {
      listeners.set(type, listener);
    },
    dispatch(type: string) {
      const listener = listeners.get(type);
      if (!listener) {
        throw new Error(`Missing ${type} listener.`);
      }
      return listener();
    }
  };
}

const SETTINGS: ExtensionSettings = {
  enabled: true,
  showOverlay: true,
  overlayPosition: "top-left"
};

function detectorState(classification: "ad" | "content"): DetectorStateMessage {
  return {
    type: "detector-state",
    phase: "stable",
    stableClassification: classification,
    rawClassification: classification,
    confidence: 1,
    reason: classification === "ad"
      ? "explicit-ad-controls-marker-present"
      : "rich-playback-controls-present",
    signals: {
      hasPlayer: true,
      hasVideo: true,
      playerMuted: false,
      hasAdControls: classification === "ad",
      hasPlayPause: true,
      hasVolume: true,
      hasRewind: false,
      hasFastForward: false,
      hasSeekSlider: false,
      hasLivePoint: classification === "content",
      hasBroadcast: false,
      hasQuality: false,
      hasFullscreen: true
    }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function loadPopup(state: PopupState, liveState?: DetectorStateMessage) {
  const elements = Object.fromEntries(
    SELECTORS.map((selector) => [selector, createElement()])
  ) as Record<Selector, TestElement>;
  const clipboardWrites: string[] = [];
  const storageWrites: Array<Record<string, unknown>> = [];
  const { record: _record, ...initialSettings } = state;
  let settings = initialSettings;
  let record = state.record;
  let readSessionRecord = async (): Promise<TabSessionRecord> => record;
  let hasActiveTab = true;
  let readLiveState = async (): Promise<DetectorStateMessage> => {
    if (!liveState) {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    }
    return liveState;
  };
  let storageChangeListener: StorageChangeListener | undefined;
  let detectorMessageListener: DetectorMessageListener | undefined;
  const context = vm.createContext({
    MlbTvAdMuterOverlayPolicy: overlayPolicy,
    chrome: {
      runtime: {
        getManifest() {
          return {
            version: "0.1.10"
          };
        },
        // No background message API: the popup must work without a background.
        onMessage: {
          addListener(listener: DetectorMessageListener) {
            detectorMessageListener = listener;
          }
        }
      },
      storage: {
        local: {
          async get(defaults: ExtensionSettings) {
            return { ...defaults, ...settings };
          },
          async set(values: Record<string, unknown>) {
            storageWrites.push({ ...values });
            settings = { ...settings, ...values };
          }
        },
        session: {
          async get(key: string) {
            assert.equal(key, "tab:7");
            return { [key]: await readSessionRecord() };
          }
        },
        onChanged: {
          addListener(listener: StorageChangeListener) {
            storageChangeListener = listener;
          }
        }
      },
      tabs: {
        async query(query: { active: boolean; currentWindow: boolean }) {
          assert.equal(query.active, true);
          assert.equal(query.currentWindow, true);
          return hasActiveTab ? [{ id: 7, mutedInfo: { muted: false } }] : [];
        },
        async sendMessage(tabId: number, message: DetectorStateRequest) {
          assert.equal(tabId, 7);
          assert.equal(message.type, "get-detector-state");
          return readLiveState();
        }
      }
    },
    document: {
      querySelector(selector: Selector) {
        return elements[selector];
      }
    },
    navigator: {
      clipboard: {
        async writeText(value: string) {
          clipboardWrites.push(value);
          throw new Error("Clipboard unavailable");
        }
      }
    }
  });

  vm.runInContext(popupSource, context);
  await flush();

  return {
    clipboardWrites,
    async dispatchSessionChange(tabId: number) {
      const listener = storageChangeListener;
      if (!listener) {
        throw new Error("Missing storage change listener.");
      }
      listener(
        { [`tab:${tabId}`]: { newValue: {} } },
        "session"
      );
      await flush();
    },
    elements,
    setRecord(nextRecord: TabSessionRecord) {
      record = nextRecord;
    },
    setSessionReader(reader: typeof readSessionRecord) {
      readSessionRecord = reader;
    },
    setLiveReader(reader: typeof readLiveState) {
      readLiveState = reader;
    },
    async broadcastDetectorState(nextState: DetectorStateMessage, tabId = 7) {
      liveState = nextState;
      assert.equal(detectorMessageListener?.(nextState, { tab: { id: tabId } }), false);
      await flush();
    },
    async changeSettings(values: Partial<ExtensionSettings>) {
      settings = { ...settings, ...values };
      storageChangeListener?.(
        Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])),
        "local"
      );
      await flush();
    },
    async clearActiveTab() {
      hasActiveTab = false;
      await this.dispatchSessionChange(7);
    },
    storageWrites
  };
}

test("renders state, persists settings, and reports clipboard failure", async () => {
  const popup = await loadPopup({
    ...SETTINGS,
    record: {
      stableClassification: "ad",
      reason: "explicit-ad-controls-marker-present",
      debugHistory: [
        {
          eventType: "navigation",
          at: 0,
          decision: "preserve-ad-mute",
          adMuteLatched: true,
          mutedByExtension: true,
          tabMuted: true,
          muteSource: "this-extension"
        }
      ]
    }
  });
  const { elements } = popup;

  assert.equal(elements["#enabled"].checked, true);
  assert.equal(elements["#mode"].textContent, "Auto-mute enabled");
  assert.equal(elements["#show-overlay"].checked, true);
  assert.equal(elements["#overlay-mode"].textContent, "Overlay visible");
  assert.equal(elements["#overlay-position"].value, "top-left");
  assert.equal(elements["#classification"].textContent, "Commercial break");
  assert.match(elements["#reason"].textContent, /commercial-break marker/);
  assert.match(
    elements["#diagnostic-log"].textContent,
    /navigation: preserve-ad-mute/
  );

  popup.setRecord({
    stableClassification: "content",
    reason: "rich-playback-controls-present"
  });
  await popup.dispatchSessionChange(7);

  assert.equal(elements["#classification"].textContent, "Game content");
  assert.match(elements["#reason"].textContent, /Rich playback/);

  elements["#enabled"].checked = false;
  await elements["#enabled"].dispatch("change");
  elements["#show-overlay"].checked = false;
  await elements["#show-overlay"].dispatch("change");
  elements["#overlay-position"].value = "top-right";
  await elements["#overlay-position"].dispatch("change");

  assert.deepEqual(popup.storageWrites, [
    { enabled: false },
    { showOverlay: false },
    { overlayPosition: "top-right" }
  ]);
  assert.equal(elements["#enabled"].checked, false);
  assert.equal(elements["#show-overlay"].checked, false);
  assert.equal(elements["#overlay-position"].value, "top-right");

  await elements["#copy-diagnostics"].dispatch("click");
  assert.equal(elements["#copy-status"].textContent, "Copy failed.");
  assert.equal(JSON.parse(popup.clipboardWrites[0]).tabId, 7);
});

test("uses live detection and saved settings when the background is unavailable", async () => {
  const popup = await loadPopup({
    ...SETTINGS,
    record: {
      stableClassification: "content",
      tabMuted: true
    }
  }, detectorState("ad"));
  const { elements } = popup;

  assert.equal(elements["#enabled"].checked, true);
  assert.equal(elements["#show-overlay"].checked, true);
  assert.equal(elements["#classification"].textContent, "Commercial break");
  await elements["#copy-diagnostics"].dispatch("click");
  assert.equal(JSON.parse(popup.clipboardWrites[0]).record.tabMuted, false);

  await popup.broadcastDetectorState(detectorState("content"), 8);
  assert.equal(elements["#classification"].textContent, "Commercial break");
  await popup.broadcastDetectorState(detectorState("content"));
  assert.equal(elements["#classification"].textContent, "Game content");

  await popup.changeSettings({ showOverlay: false, overlayPosition: "top-right" });
  assert.equal(elements["#show-overlay"].checked, false);
  assert.equal(elements["#overlay-position"].value, "top-right");
});

test("keeps saved settings on tabs without a content monitor or active tab", async () => {
  const popup = await loadPopup({ ...SETTINGS, record: {} });
  assert.equal(popup.elements["#enabled"].checked, true);
  assert.equal(popup.elements["#show-overlay"].checked, true);
  assert.equal(popup.elements["#classification"].textContent, "Unknown");

  await popup.clearActiveTab();
  assert.equal(popup.elements["#enabled"].checked, true);
  assert.equal(popup.elements["#show-overlay"].checked, true);
  assert.equal(popup.elements["#classification"].textContent, "Unknown");
  await popup.elements["#copy-diagnostics"].dispatch("click");
  assert.equal(popup.elements["#copy-status"].textContent, "Nothing to copy yet.");
});

test("clears stale diagnostics on a storage error without resetting saved settings", async () => {
  const popup = await loadPopup({ ...SETTINGS, record: {} }, detectorState("ad"));
  popup.setSessionReader(async () => { throw new Error("Simulated storage failure"); });
  await popup.dispatchSessionChange(7);

  assert.equal(
    popup.elements["#classification"].textContent,
    "Unavailable"
  );
  assert.match(
    popup.elements["#reason"].textContent,
    /Simulated storage failure/
  );
  assert.equal(popup.elements["#enabled"].checked, true);
  assert.equal(popup.elements["#show-overlay"].checked, true);
  assert.equal(popup.elements["#status-dot"].className, "dot unknown");
  assert.equal(popup.elements["#diagnostic-log"].textContent, "No transitions recorded yet.");

  await popup.elements["#copy-diagnostics"].dispatch("click");
  assert.equal(
    popup.elements["#copy-status"].textContent,
    "Nothing to copy yet."
  );
  assert.deepEqual(popup.clipboardWrites, []);
});

test("ignores a delayed detector response after a newer refresh", async () => {
  const popup = await loadPopup({ ...SETTINGS, record: {} }, detectorState("content"));
  let finishOldRead!: (state: DetectorStateMessage) => void;
  popup.setLiveReader(() => new Promise((resolve) => { finishOldRead = resolve; }));
  await popup.dispatchSessionChange(7);

  popup.setLiveReader(async () => detectorState("ad"));
  await popup.broadcastDetectorState(detectorState("ad"));
  assert.equal(popup.elements["#classification"].textContent, "Commercial break");

  finishOldRead(detectorState("content"));
  await flush();
  assert.equal(popup.elements["#classification"].textContent, "Commercial break");
});

test("ignores an older refresh failure after newer state is displayed", async () => {
  const popup = await loadPopup({ ...SETTINGS, record: {} }, detectorState("content"));
  let failOldRead!: (error: Error) => void;
  popup.setSessionReader(() => new Promise((_resolve, reject) => { failOldRead = reject; }));
  await popup.dispatchSessionChange(7);

  popup.setSessionReader(async () => ({}));
  await popup.broadcastDetectorState(detectorState("ad"));
  failOldRead(new Error("Outdated storage failure"));
  await flush();

  assert.equal(popup.elements["#classification"].textContent, "Commercial break");
  await popup.elements["#copy-diagnostics"].dispatch("click");
  assert.equal(JSON.parse(popup.clipboardWrites[0]).record.stableClassification, "ad");
});
