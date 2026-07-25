"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

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
];

function createElement() {
  const listeners = new Map();

  return {
    checked: false,
    className: "",
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      return listeners.get(type)();
    }
  };
}

async function loadPopup(response) {
  const elements = Object.fromEntries(
    SELECTORS.map((selector) => [selector, createElement()])
  );
  const clipboardWrites = [];
  const storageWrites = [];
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return {
            version: "0.1.10"
          };
        },
        async sendMessage(message) {
          assert.equal(message.type, "get-popup-state");
          assert.equal(message.tabId, 7);
          return response;
        }
      },
      storage: {
        local: {
          async set(values) {
            storageWrites.push({ ...values });
          }
        }
      },
      tabs: {
        async query(query) {
          assert.equal(query.active, true);
          assert.equal(query.currentWindow, true);
          return [{ id: 7 }];
        }
      }
    },
    document: {
      querySelector(selector) {
        return elements[selector];
      }
    },
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
          throw new Error("Clipboard unavailable");
        }
      }
    }
  });

  vm.runInContext(popupSource, context);
  await new Promise((resolve) => setImmediate(resolve));

  return {
    clipboardWrites,
    elements,
    storageWrites
  };
}

test("renders state, persists settings, and reports clipboard failure", async () => {
  const popup = await loadPopup({
    enabled: true,
    showOverlay: true,
    overlayPosition: "top-left",
    record: {
      stableClassification: "ad",
      reason: "explicit-ad-controls-marker-present",
      debugHistory: [
        {
          eventType: "navigation",
          at: 0,
          decision: "preserve-ad-mute"
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
  assert.match(elements["#reason"].textContent, /commercial-controls marker/);
  assert.match(
    elements["#diagnostic-log"].textContent,
    /navigation: preserve-ad-mute/
  );

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

  await elements["#copy-diagnostics"].dispatch("click");
  assert.equal(elements["#copy-status"].textContent, "Copy failed.");
  assert.equal(JSON.parse(popup.clipboardWrites[0]).tabId, 7);
});

test("renders a background error without stale diagnostics", async () => {
  const popup = await loadPopup({
    error: "Simulated background failure"
  });

  assert.equal(
    popup.elements["#classification"].textContent,
    "Unavailable"
  );
  assert.equal(
    popup.elements["#reason"].textContent,
    "Simulated background failure"
  );

  await popup.elements["#copy-diagnostics"].dispatch("click");
  assert.equal(
    popup.elements["#copy-status"].textContent,
    "Nothing to copy yet."
  );
  assert.deepEqual(popup.clipboardWrites, []);
});
