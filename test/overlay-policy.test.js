"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_POSITION,
  POSITIONS,
  getMountTarget,
  normalizePosition
} = require("../src/overlay-policy.js");

test("supports each on-page status corner", () => {
  assert.deepEqual(POSITIONS, [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right"
  ]);

  for (const position of POSITIONS) {
    assert.equal(normalizePosition(position), position);
  }
});

test("defaults invalid overlay positions to bottom-right", () => {
  assert.equal(DEFAULT_POSITION, "bottom-right");
  assert.equal(normalizePosition("center"), DEFAULT_POSITION);
  assert.equal(normalizePosition(undefined), DEFAULT_POSITION);
});

test("mounts the overlay inside the active fullscreen element", () => {
  const fullscreenElement = { id: "fullscreen-player" };
  const documentElement = { id: "document-root" };

  assert.equal(
    getMountTarget({
      fullscreenElement,
      documentElement
    }),
    fullscreenElement
  );
});

test("supports the legacy WebKit fullscreen property", () => {
  const webkitFullscreenElement = { id: "webkit-fullscreen-player" };

  assert.equal(
    getMountTarget({
      fullscreenElement: null,
      webkitFullscreenElement,
      documentElement: { id: "document-root" }
    }),
    webkitFullscreenElement
  );
});

test("mounts inside MLB's CSS fullscreen wrapper", () => {
  const cssFullscreenElement = { id: "css-fullscreen-player" };

  assert.equal(
    getMountTarget({
      fullscreenElement: null,
      webkitFullscreenElement: null,
      querySelector(selector) {
        assert.equal(selector, ".mlbtv-player--full-screen");
        return cssFullscreenElement;
      },
      documentElement: { id: "document-root" }
    }),
    cssFullscreenElement
  );
});

test("returns the overlay to the document after fullscreen exits", () => {
  const documentElement = { id: "document-root" };

  assert.equal(
    getMountTarget({
      fullscreenElement: null,
      webkitFullscreenElement: null,
      querySelector() {
        return null;
      },
      documentElement
    }),
    documentElement
  );
});
