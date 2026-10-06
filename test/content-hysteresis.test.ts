import test from "node:test";
import assert from "node:assert/strict";
import type { PlayerClassification } from "../src/shared/types.ts";
import { TIMING_MS } from "../src/content/timing-policy.ts";
import { loadContent } from "./helpers/content.ts";

test("handles sustained, flickering, and replaced-player transitions", async () => {
  const monitor = await loadContent();
  const { advance } = monitor.clock;
  const stableCount = (classification: PlayerClassification) => monitor.messages.filter(
    (message) => message.phase === "stable" && message.stableClassification === classification
  ).length;

  function assertLiveSnapshot(classification: PlayerClassification) {
    const count = monitor.messages.length;
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot?.stableClassification, classification);
    assert.deepEqual(snapshot, monitor.messages.at(-1));
    assert.equal(
      monitor.messages.length,
      count,
      "Reading state must not trigger another broadcast."
    );
  }

  assert.equal(monitor.observedTargets[0], monitor.playerWrapper);
  await advance(TIMING_MS.content - 1);
  assert.equal(stableCount("content"), 0);
  await advance(1);
  assert.equal(stableCount("content"), 1);
  await monitor.requestRefresh();
  assert.equal(stableCount("content"), 2);
  assertLiveSnapshot("content");

  // A brief loss of rich controls must not mute game audio.
  monitor.showControls("ad");
  monitor.mutate();
  await advance(TIMING_MS.debounce + 50);
  monitor.showControls("content");
  monitor.mutate();
  await advance(TIMING_MS.debounce);
  assert.equal(stableCount("ad"), 0);

  monitor.showControls("ad");
  monitor.mutate();
  await advance(TIMING_MS.debounce + TIMING_MS.heuristicAd - 1);
  assert.equal(stableCount("ad"), 0);
  await advance(1);
  assert.equal(stableCount("ad"), 1);
  assertLiveSnapshot("ad");

  const beforeReturn = stableCount("content");
  monitor.showControls("content");
  monitor.mutate();
  await advance(TIMING_MS.debounce + TIMING_MS.content - 1);
  assert.equal(stableCount("content"), beforeReturn);
  await advance(1);
  assert.equal(stableCount("content"), beforeReturn + 1);

  const beforeReplacement = stableCount("ad");
  monitor.showControls("ad", true);
  monitor.replacePlayer();
  await advance(0);
  assert.equal(stableCount("ad"), beforeReplacement + 1);
});
