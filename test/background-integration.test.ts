import test from "node:test";
import assert from "node:assert/strict";
import type { DetectorRefreshMessage, TabAudioStateMessage } from "../src/shared/types.ts";
import { loadBackground } from "./helpers/background.ts";
import type { TestDetectorResponse } from "./helpers/background.ts";
import { flush } from "./helpers/clock.ts";

function assertAudioState(
  value: TestDetectorResponse
): asserts value is TabAudioStateMessage {
  assert.equal(value.type, "tab-audio-state");
}

async function exerciseMuteLifecycle(buildDirectory: string): Promise<void> {
  const background = loadBackground(buildDirectory);
  const {
    tabId,
    runtimeId,
    tab,
    settings,
    session,
    listeners,
    alarms,
    tabMessages,
    tabUpdates,
    startBackground,
    sendDetectorState,
    emitTabUpdate,
    emitReleaseRetry
  } = background;

  tab.mutedInfo = {
    muted: true,
    reason: "user"
  };
  let response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(response.muteSource, "user");

  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(response.muteSource, "user");
  assert.deepEqual(tabUpdates, []);

  tab.mutedInfo = {
    muted: false
  };
  background.failNextTabUpdate(new Error("Simulated tab update failure"));
  response = await sendDetectorState("ad");
  assert.equal(response.type, "detector-error");
  assert.equal("error" in response, true);
  if (!("error" in response)) {
    throw new Error("Expected a detector error response.");
  }
  assert.match(response.error, /Simulated tab update failure/);

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);
  assert.equal(tab.mutedInfo.extensionId, runtimeId);

  const userUnmute = {
    muted: false,
    reason: "user"
  } satisfies chrome.tabs.MutedInfo;
  tab.mutedInfo = userUnmute;
  await emitTabUpdate({ mutedInfo: userUnmute });

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, false);
  assert.equal(response.manualAdOverride, true);

  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.manualAdOverride, false);

  response = await sendDetectorState("ad");
  assertAudioState(response);
  assert.equal(response.tabMuted, true);

  // Both browsers can unload the background context between events.
  startBackground();
  tabMessages.length = 0;
  await emitTabUpdate({
    status: "loading",
    url: tab.url
  });
  assert.equal(session[`tab:${tabId}`]?.stableClassification, "unknown");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(
    tabMessages.some(
      (message) =>
        (message as DetectorRefreshMessage).type ===
        "refresh-detector-state"
    ),
    true
  );

  response = await sendDetectorState("ad");
  assertAudioState(response);

  const unsupportedUrl = "https://example.com/";
  tab.url = unsupportedUrl;
  await emitTabUpdate({
    status: "loading",
    url: unsupportedUrl
  });

  assert.equal(tab.mutedInfo.muted, false);
  assert.deepEqual(tabUpdates, [true, true, false]);
  assert.equal(session[`tab:${tabId}`]?.stableClassification, "unknown");
  assert.equal(
    session[`tab:${tabId}`]?.lastDecision,
    "release-navigation-mute"
  );

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  background.failNextTabGet(new Error("Simulated tab lookup failure"));
  response = await sendDetectorState("content");
  assert.equal(response.type, "detector-error");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  background.failNextTabUpdate(new Error("Simulated unmute failure"));
  response = await sendDetectorState("content");
  assert.equal(response.type, "detector-error");
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  // A failed release must remain retryable across a background restart.
  startBackground();
  response = await sendDetectorState("content");
  assertAudioState(response);
  assert.equal(response.tabMuted, false);
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);

  await sendDetectorState("ad");
  background.failNextTabUpdate(new Error("Simulated navigation unmute failure"));
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  assert.equal(alarms.get(`release-mute:${tabId}`)?.periodInMinutes, 1);
  startBackground();
  background.failNextTabUpdate(new Error("Simulated repeated unmute failure"));
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(alarms.has(`release-mute:${tabId}`), true);

  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  background.failNextTabUpdate(new Error("Simulated navigation unmute failure"));
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  tab.url = "https://www.mlb.com/tv/another-game";
  const updatesBeforeRetry = tabUpdates.length;
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(tabUpdates.length, updatesBeforeRetry);
  assert.equal(
    (tabMessages.at(-1) as DetectorRefreshMessage).type,
    "refresh-detector-state"
  );
  await sendDetectorState("ad");
  assert.equal(alarms.has(`release-mute:${tabId}`), false);

  background.failNextTabUpdate(new Error("Simulated navigation unmute failure"));
  tab.url = unsupportedUrl;
  await emitTabUpdate({ status: "loading", url: unsupportedUrl });
  tab.mutedInfo = { muted: true, reason: "user" };
  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(tabUpdates.length, updatesBeforeRetry);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
  tab.mutedInfo = { muted: false };

  tab.url = "https://www.mlb.com/tv/game";
  await sendDetectorState("ad");
  background.failNextTabUpdate(new Error("Simulated disable unmute failure"));
  settings.enabled = false;
  listeners.storageChanged!({ enabled: { newValue: false } }, "local");
  await flush();
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, true);

  await emitReleaseRetry();
  assert.equal(tab.mutedInfo.muted, false);
  assert.equal(session[`tab:${tabId}`]?.mutedByExtension, false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
  settings.enabled = true;

  for (let index = 0; index < 40; index += 1) {
    await sendDetectorState("content");
  }

  assert.equal(session[`tab:${tabId}`]?.debugHistory?.length, 40);

  const validKey = `tab:${tabId}`;
  const validRecord = session[validKey];
  assert.ok(validRecord);
  delete session[validKey];
  session["tab:99"] = { mutedByExtension: true };
  session[validKey] = validRecord;

  const blockedMute = Promise.withResolvers<void>();
  const muteStarted = Promise.withResolvers<void>();
  background.blockNextMute({
    release: blockedMute.promise,
    started: () => muteStarted.resolve()
  });

  const pendingAd = sendDetectorState("ad");
  await muteStarted.promise;

  settings.enabled = false;
  listeners.storageChanged!(
    { enabled: { newValue: false } },
    "local"
  );
  blockedMute.resolve();
  await pendingAd;

  for (let attempt = 0; attempt < 10 && tab.mutedInfo.muted; attempt += 1) {
    await flush();
  }

  assert.equal(tab.mutedInfo.muted, false);
  assert.deepEqual(tabUpdates.slice(-2), [true, false]);

  assert.equal(alarms.has("release-mute:99"), true);
  await emitReleaseRetry(99);
  assert.equal(alarms.has("release-mute:99"), false);
  assert.equal(Object.hasOwn(session, "tab:99"), false);

  settings.enabled = true;
  const removalBlockedMute = Promise.withResolvers<void>();
  const removalMuteStarted = Promise.withResolvers<void>();
  background.blockNextMute({
    release: removalBlockedMute.promise,
    started: () => removalMuteStarted.resolve()
  });

  const pendingRemovedTabAd = sendDetectorState("ad");
  await removalMuteStarted.promise;
  background.failNextTabUpdate(new Error("Simulated unmute failure before tab closure"));
  const pendingRemovedTabRelease = sendDetectorState("content");
  listeners.tabRemoved!(tabId);
  removalBlockedMute.resolve();
  await pendingRemovedTabAd;
  assert.equal((await pendingRemovedTabRelease).type, "detector-error");

  for (
    let attempt = 0;
    attempt < 10 && (
      Object.hasOwn(session, validKey) ||
      alarms.has(`release-mute:${tabId}`)
    );
    attempt += 1
  ) {
    await flush();
  }

  assert.equal(Object.hasOwn(session, validKey), false);
  assert.equal(alarms.has(`release-mute:${tabId}`), false);
}

for (const buildDirectory of ["dist", "dist-firefox"]) {
  test(`${buildDirectory}: mute lifecycle, background restart, and cleanup`, () =>
    exerciseMuteLifecycle(buildDirectory)
  );
}
