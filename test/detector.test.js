"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SELECTORS,
  classifySignals,
  collectSignals
} = require("../dist/src/detector.js");

function signals(overrides = {}) {
  return {
    hasPlayer: true,
    hasVideo: true,
    playerMuted: false,
    hasAdControls: false,
    hasPlayPause: true,
    hasVolume: true,
    hasRewind: false,
    hasFastForward: false,
    hasSeekSlider: false,
    hasLivePoint: false,
    hasBroadcast: false,
    hasQuality: false,
    hasFullscreen: false,
    ...overrides
  };
}

function fakeDocument(selectors, { playerMuted = false } = {}) {
  const available = new Set(selectors);
  const scope = {
    muted: playerMuted,
    querySelector(selector) {
      return available.has(selector) ? scope : null;
    }
  };

  return scope;
}

test("classifies the observed rich live-player controls as content", () => {
  const result = classifySignals(
    signals({
      hasRewind: true,
      hasFastForward: true,
      hasSeekSlider: true,
      hasLivePoint: true,
      hasBroadcast: true,
      hasQuality: true,
      hasFullscreen: true
    })
  );

  assert.equal(result.classification, "content");
  assert.equal(result.confidence, 1);
});

test("classifies pause-and-volume-only playback as an ad", () => {
  const result = classifySignals(signals());

  assert.equal(result.classification, "ad");
  assert.equal(result.reason, "only-minimal-playback-controls-present");
});

test("prioritizes the explicit live ad-controls marker", () => {
  const result = classifySignals(
    signals({
      hasAdControls: true,
      hasRewind: true,
      hasFastForward: true,
      hasSeekSlider: true
    })
  );

  assert.equal(result.classification, "ad");
  assert.equal(result.confidence, 1);
  assert.equal(result.reason, "explicit-ad-controls-marker-present");
});

test("does not classify a missing player as an ad", () => {
  const result = classifySignals(
    signals({
      hasPlayer: false,
      hasVideo: false
    })
  );

  assert.equal(result.classification, "unknown");
});

test("keeps mixed transitional controls unknown", () => {
  const result = classifySignals(
    signals({
      hasRewind: true,
      hasBroadcast: true
    })
  );

  assert.equal(result.classification, "unknown");
});

test("collects semantic controls without depending on generated CSS classes", () => {
  const documentRoot = fakeDocument([
    SELECTORS.player,
    SELECTORS.video,
    SELECTORS.pause,
    SELECTORS.mute,
    SELECTORS.rewind,
    SELECTORS.fastForward,
    SELECTORS.seekSlider,
    SELECTORS.livePoint,
    SELECTORS.broadcast,
    SELECTORS.quality,
    SELECTORS.fullscreen
  ]);

  assert.deepEqual(collectSignals(documentRoot), {
    hasPlayer: true,
    hasVideo: true,
    playerMuted: false,
    hasAdControls: false,
    hasPlayPause: true,
    hasVolume: true,
    hasRewind: true,
    hasFastForward: true,
    hasSeekSlider: true,
    hasLivePoint: true,
    hasBroadcast: true,
    hasQuality: true,
    hasFullscreen: true
  });
});

test("collects the player controller's muted state for diagnostics", () => {
  const documentRoot = fakeDocument(
    [
      SELECTORS.player,
      SELECTORS.video
    ],
    { playerMuted: true }
  );

  assert.equal(collectSignals(documentRoot).playerMuted, true);
});
