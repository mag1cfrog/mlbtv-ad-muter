"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getMountTarget } = require("../src/overlay-policy.js");

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
