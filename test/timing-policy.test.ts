import test from "node:test";
import assert from "node:assert/strict";
import {
  TIMING_MS,
  confirmationDelayFor,
  muteRetryDelay
} from "../src/content/timing-policy.ts";

test("confirms the explicit commercial marker immediately", () => {
  assert.equal(
    confirmationDelayFor({
      classification: "ad",
      reason: "explicit-ad-controls-marker-present"
    }),
    0
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
