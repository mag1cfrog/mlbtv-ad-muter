import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import type {
  DetectorStateMessage,
  DetectorStateRequest,
  ExtensionSettings,
  PopupState,
  TabSessionRecord
} from "../../src/shared/types.ts";
import { flush } from "./clock.ts";

const popupSource = fs.readFileSync(
  new URL("../../dist/src/popup.js", import.meta.url),
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

export async function loadPopup(state: PopupState, liveState?: DetectorStateMessage) {
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
      assert.equal(
        detectorMessageListener?.(nextState, { tab: { id: tabId } }),
        false
      );
      await flush();
    },
    async changeSettings(values: Partial<ExtensionSettings>) {
      settings = { ...settings, ...values };
      storageChangeListener?.(
        Object.fromEntries(
          Object.entries(values).map(([key, newValue]) => [key, { newValue }])
        ),
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
