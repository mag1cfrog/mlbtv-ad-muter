"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyMuteSource,
  decideMuteAction
} = require("../src/mute-policy.js");

function decision(overrides = {}) {
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

test("a full ad-pod sequence cannot unmute on a transient control flicker", () => {
  let muted = false;
  const sequence = [
    { phase: "stable", stableClassification: "content" },
    { phase: "candidate", stableClassification: "content" },
    { phase: "stable", stableClassification: "ad" },
    { phase: "candidate", stableClassification: "ad" },
    { phase: "stable", stableClassification: "ad" },
    { phase: "candidate", stableClassification: "ad" }
  ];

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
