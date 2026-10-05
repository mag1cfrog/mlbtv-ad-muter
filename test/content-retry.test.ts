import test from "node:test";
import assert from "node:assert/strict";
import { TIMING_MS } from "../src/content/timing-policy.ts";
import { loadContent } from "./helpers/content.ts";

test("retries failed muting and unmuting and reports unavailable video audio", async () => {
  let muteAttempts = 0;
  let releaseAttempts = 0;
  let tabMuted = false;
  const monitor = await loadContent({
    initialState: "ad",
    explicitAd: true,
    showOverlay: true,
    respond(message) {
      if (message.stableClassification === "ad") {
        tabMuted = ++muteAttempts > 1;
      } else if (message.phase === "stable" && message.stableClassification === "content") {
        if (++releaseAttempts === 1) {
          return { type: "detector-error", error: "Simulated unmute failure" };
        }
        tabMuted = false;
      }
      return {
        type: "tab-audio-state",
        enabled: true,
        tabMuted,
        manualAdOverride: false,
        muteSource: "this-extension"
      };
    }
  });
  const { advance } = monitor.clock;
  assert.equal(muteAttempts, 1);
  await advance(TIMING_MS.muteAcknowledgment);
  assert.equal(muteAttempts, 2);
  assert.equal(monitor.overlay.label.textContent, "AD · MUTED");

  monitor.showControls("content");
  monitor.mutate();
  await advance(TIMING_MS.debounce + TIMING_MS.content);
  assert.equal(releaseAttempts, 1);
  assert.equal(tabMuted, true);
  await advance(TIMING_MS.watchdog);
  assert.equal(releaseAttempts, 2);
  assert.match(monitor.overlay.details.textContent, /stable: content.*tab: audible/);

  const count = monitor.messages.length;
  await advance(TIMING_MS.watchdog);
  assert.equal(monitor.messages.length, count);
  monitor.removeVideo();
  await advance(TIMING_MS.debounce + TIMING_MS.unknown);
  assert.match(monitor.overlay.details.textContent, /video: unavailable/);
});

test("moves the bundled overlay into fullscreen and stops after context invalidation", async () => {
  let invalidated = false;
  const monitor = await loadContent({
    initialState: "ad",
    explicitAd: true,
    showOverlay: true,
    respond() {
      if (invalidated) {
        throw new Error("Extension context invalidated");
      }
      return {
        type: "tab-audio-state",
        enabled: true,
        tabMuted: true,
        manualAdOverride: false,
        muteSource: "this-extension"
      };
    }
  });
  assert.match(monitor.overlay.style.textContent, /:host/);
  assert.match(monitor.overlay.shadow.innerHTML, /role="status"/);
  const fullscreenTarget = monitor.enterFullscreen();
  assert.equal(monitor.overlay.host.parentNode, fullscreenTarget);
  invalidated = true;
  await monitor.requestRefresh();
  assert.equal(monitor.overlay.label.textContent, "RELOAD PAGE");
  assert.equal(monitor.clock.pendingCount(), 0);
});
