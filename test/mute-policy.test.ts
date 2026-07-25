"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyMuteSource,
  describeTabMuteState,
  decideMuteAction,
  shouldPreserveAdMuteOnNavigation,
  shouldRepairUnmute
} = require("../dist/src/mute-policy.js") as MutePolicy;

function decision(
  overrides: Partial<DecideMuteActionInput> = {}
): MuteDecision {
  return decideMuteAction({
    enabled: true,
    phase: "stable",
    stableClassification: "content",
    ...overrides
  });
}

test("mutes when a commercial becomes stable", () => {
  assert.equal(
    decision({ stableClassification: "ad" }).action,
    "ensure-muted"
  );
});

test("keeps the tab muted during a candidate content flicker", () => {
  assert.equal(
    decision({
      phase: "candidate",
      stableClassification: "ad"
    }).action,
    "ensure-muted"
  );
});

test("releases mute only after game content is stable", () => {
  assert.equal(
    decision({
      phase: "stable",
      stableClassification: "content"
    }).action,
    "release"
  );
});

test("holds the current mute state during unknown transitions", () => {
  assert.equal(
    decision({
      phase: "candidate",
      stableClassification: "unknown"
    }).action,
    "hold"
  );
});

test("releases mute immediately when auto-muting is disabled", () => {
  assert.equal(
    decision({
      enabled: false,
      phase: "candidate",
      stableClassification: "ad"
    }).action,
    "release"
  );
});

test("respects a manual tab-unmute override for the current ad pod", () => {
  assert.deepEqual(
    decision({
      manualAdOverride: true,
      stableClassification: "ad"
    }),
    {
      action: "hold",
      reason: "manual-ad-override"
    }
  );
});

test("a full ad-pod sequence cannot unmute on a transient control flicker", () => {
  let muted = false;
  const sequence = [
    { phase: "stable", stableClassification: "content" },
    { phase: "candidate", stableClassification: "content" },
    { phase: "stable", stableClassification: "ad" },
    { phase: "candidate", stableClassification: "ad" },
    { phase: "stable", stableClassification: "ad" },
    { phase: "candidate", stableClassification: "ad" }
  ] satisfies readonly Partial<DecideMuteActionInput>[];

  const mutedStates = sequence.map((message) => {
    const result = decision(message);

    if (result.action === "ensure-muted") {
      muted = true;
    } else if (result.action === "release") {
      muted = false;
    }

    return muted;
  });

  assert.deepEqual(mutedStates, [
    false,
    false,
    true,
    true,
    true,
    true
  ]);
});

test("identifies mute changes made by this extension", () => {
  assert.equal(
    classifyMuteSource(
      {
        muted: true,
        reason: "extension",
        extensionId: "self"
      },
      "self"
    ),
    "this-extension"
  );
});

test("does not retain another extension's ID in the mute source", () => {
  assert.equal(
    classifyMuteSource(
      {
        muted: false,
        reason: "extension",
        extensionId: "some-private-id"
      },
      "self"
    ),
    "other-extension"
  );
});

test("preserves user and capture mute-source categories", () => {
  assert.equal(
    classifyMuteSource({ muted: true, reason: "user" }, "self"),
    "user"
  );
  assert.equal(
    classifyMuteSource({ muted: true, reason: "capture" }, "self"),
    "capture"
  );
});

test("derives mute ownership from Chrome's actual tab state", () => {
  assert.deepEqual(
    describeTabMuteState(
      {
        muted: true,
        reason: "extension",
        extensionId: "self"
      },
      "self"
    ),
    {
      tabMuted: true,
      muteSource: "this-extension",
      mutedByExtension: true
    }
  );

  assert.deepEqual(
    describeTabMuteState(
      {
        muted: false,
        reason: "extension",
        extensionId: "self"
      },
      "self"
    ),
    {
      tabMuted: false,
      muteSource: "this-extension",
      mutedByExtension: false
    }
  );
});

test("repairs only an unintended extension-originated unmute during an ad", () => {
  const stableAd = {
    enabled: true,
    manualAdOverride: false,
    stableClassification: "ad",
    tabMuted: false
  } satisfies Omit<RepairUnmuteInput, "muteSource">;

  assert.equal(
    shouldRepairUnmute({
      ...stableAd,
      muteSource: "this-extension"
    }),
    true
  );
  assert.equal(
    shouldRepairUnmute({
      ...stableAd,
      muteSource: "user"
    }),
    false
  );
  assert.equal(
    shouldRepairUnmute({
      ...stableAd,
      manualAdOverride: true,
      muteSource: "this-extension"
    }),
    false
  );
  assert.equal(
    shouldRepairUnmute({
      ...stableAd,
      stableClassification: "content",
      muteSource: "this-extension"
    }),
    false
  );
});

test("preserves an ad mute across supported stream navigation", () => {
  const activeAdNavigation = {
    adMuteLatched: true,
    enabled: true,
    isSupportedStream: true,
    manualAdOverride: false,
    stableClassification: "unknown"
  } satisfies PreserveAdMuteInput;

  assert.equal(
    shouldPreserveAdMuteOnNavigation(activeAdNavigation),
    true
  );
  assert.equal(
    shouldPreserveAdMuteOnNavigation({
      ...activeAdNavigation,
      adMuteLatched: false,
      stableClassification: "ad"
    }),
    true
  );
  assert.equal(
    shouldPreserveAdMuteOnNavigation({
      ...activeAdNavigation,
      isSupportedStream: false
    }),
    false
  );
  assert.equal(
    shouldPreserveAdMuteOnNavigation({
      ...activeAdNavigation,
      manualAdOverride: true
    }),
    false
  );
  assert.equal(
    shouldPreserveAdMuteOnNavigation({
      ...activeAdNavigation,
      enabled: false
    }),
    false
  );
});
