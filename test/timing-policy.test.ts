"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TIMING_MS,
  confirmationDelayFor,
  muteRetryDelay
} = require("../dist/src/timing-policy.js") as TimingPolicy;

test("confirms the explicit commercial marker quickly", () => {
  assert.equal(
    confirmationDelayFor({
      classification: "ad",
      reason: "explicit-ad-controls-marker-present"
    }),
    300
  );
});

test("requires longer confirmation for heuristic ad detection", () => {
  assert.equal(
    confirmationDelayFor({
      classification: "ad",
      reason: "only-minimal-playback-controls-present"
    }),
    900
  );
});

test("requires two seconds of stable content before unmuting", () => {
  assert.equal(
    confirmationDelayFor({
      classification: "content",
      reason: "rich-playback-controls-present"
    }),
    2000
  );
});

test("keeps the watchdog interval at 1.5 seconds", () => {
  assert.equal(TIMING_MS.watchdog, 1500);
});

test("retries an unacknowledged mute quickly with a bounded backoff", () => {
  assert.equal(muteRetryDelay(0), 500);
  assert.equal(muteRetryDelay(1), 1000);
  assert.equal(muteRetryDelay(2), 1500);
  assert.equal(muteRetryDelay(20), 1500);
  assert.equal(muteRetryDelay(-1), 500);
});

test("debounces mutation bursts for 80 milliseconds", () => {
  assert.equal(TIMING_MS.debounce, 80);
});
