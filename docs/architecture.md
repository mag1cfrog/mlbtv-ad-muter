# Architecture

Ad Muter for MLB.TV has three entry points: the content monitor, background,
and popup. Each uses ordinary TypeScript imports. esbuild bundles each entry
point into a self-contained, unminified script. The installed extension has
no third-party runtime dependencies.

## Where to start

| Change | Source |
| --- | --- |
| Player selectors or classification rules | [`content/detector.ts`](../src/content/detector.ts) |
| Confirmation and retry delays | [`content/timing-policy.ts`](../src/content/timing-policy.ts) |
| DOM observation, stabilization, or message retries | [`content.ts`](../src/content.ts) |
| Overlay text or appearance | [`content/overlay.ts`](../src/content/overlay.ts), [`content/overlay.css`](../src/content/overlay.css) |
| Mute, hold, or release decisions | [`background/mute-policy.ts`](../src/background/mute-policy.ts) |
| Detection, navigation, or disable handling | [`background/controller.ts`](../src/background/controller.ts) |
| Browser tab-audio calls and release alarms | [`background/tab-audio.ts`](../src/background/tab-audio.ts) |
| Diagnostic history and mute ownership updates | [`background/tab-state.ts`](../src/background/tab-state.ts) |
| Browser event registration or per-tab ordering | [`background.ts`](../src/background.ts), [`background/tab-queue.ts`](../src/background/tab-queue.ts) |
| Popup refreshes and user actions | [`popup.ts`](../src/popup.ts) |
| Popup data or rendering | [`popup/state.ts`](../src/popup/state.ts), [`popup/view.ts`](../src/popup/view.ts) |
| Settings defaults or stored tab records | [`shared/settings.ts`](../src/shared/settings.ts), [`shared/tab-session.ts`](../src/shared/tab-session.ts) |
| Overlay position validation or fullscreen mounting | [`shared/overlay-policy.ts`](../src/shared/overlay-policy.ts) |
| Messages and stored-data shapes | [`shared/types.ts`](../src/shared/types.ts) |

Entry points wire together modules with a specific responsibility. Policy
functions return decisions without changing browser state. Browser operations
stay in the content monitor, background, or popup that owns them. Shared
modules define the settings and data passed between those contexts.

## Follow a commercial break

1. The content monitor observes player controls. The detector reads semantic
   selectors and classifies them as `ad`, `content`, or `unknown`.
2. The monitor applies the timing policy. Explicit ad markers take effect
   immediately; heuristic ads and returning game controls need confirmation.
   The current DOM reading is `rawClassification`. The confirmed result is
   `stableClassification`.
3. The monitor saves a detector snapshot, renders the overlay, and sends
   changed snapshots to the background. The popup can request that same
   snapshot directly without triggering another broadcast.
4. The background queues the message with other work for that tab. Its
   controller asks the mute policy what to do, then calls the tab-audio module.
   This is the only module that changes the browser tab's audio.
5. The background records the transition, persists the tab record, updates the
   badge, and reports the tab's actual mute state to the content monitor.
6. The popup refreshes on detector messages and storage changes. It combines
   saved settings and diagnostics with the live detector snapshot and the
   active tab's mute state. A refresh sequence number prevents an older result
   or error from overwriting a newer one.

Detection and audio state are separate. Recognizing an ad does not confirm
that the browser has muted the tab. The overlay uses the background's audio
acknowledgment to distinguish muting, retrying, muted, and manual override.
Both UIs use the stable classification; the overlay also displays candidate
transitions while confirmation is pending.

## State and ownership

`chrome.storage.local` holds `enabled`, `showOverlay`, and `overlayPosition`.
The shared settings module provides defaults and validates the position.
The popup reads settings independently of the background, so a background
failure does not reset the controls it displays.

`chrome.storage.session` holds a record under `tab:<id>` with current detection,
mute ownership, and at most 40 diagnostic events. Fields are optional because
navigation or audio events can arrive before the first detection. Tab closure
removes the record. The popup displays the last 10 events and can copy the
full record for troubleshooting.

The following rules must hold when changing audio behavior:

- Only release a mute owned by this extension. Check the browser's current
  mute source before unmuting; a stored ownership flag alone is insufficient.
- Keep an established ad mute through candidate and unknown transitions.
  Confirmed game content clears the ad latch and manual override.
- Respect a manual unmute for the current ad pod. Reloading a supported stream
  preserves an established ad mute unless there is a manual override.
- Disabling auto-mute or leaving a supported stream releases an
  extension-owned mute.
- Serialize detection, audio changes, navigation, disable handling, retries,
  and removal through the per-tab queue. Re-read stored state inside queued
  work so an earlier event's result is visible.

The content monitor retains its timers, candidate state, and last sent
snapshot in memory. Background queues also exist only within that background
context. Persistent settings and session records allow background restarts
without relying on module globals from a previous context.

## Retry behavior

Failed tab lookups or unmute requests preserve stored mute ownership. A
detector error clears message deduplication so the content watchdog can retry
even when the player state has not changed. Missing mute acknowledgments have
their own bounded retry delay in the content monitor.

A failed release also schedules a browser alarm every minute, subject to
browser scheduling delays. The required `alarms` permission lets a release
retry after navigation removes the content monitor.
[Browser alarms survive an idle background unload](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts#change_timers_into_alarms).
Each retry checks the current tab and settings. On an enabled MLB.TV stream,
it requests fresh detection before changing audio; otherwise it retries the
release. Successful muting, release, and tab closure cancel the alarm. A retry
also removes stale records for closed tabs.

## Build and browser compatibility

[`scripts/build.js`](../scripts/build.js) type-checks the source, bundles the
three entry points, copies static assets, and creates both packages:

| Package | Manifest | Background environment |
| --- | --- | --- |
| `dist` | [`manifest.json`](../manifest.json) | Chrome service worker |
| `dist-firefox` | Base manifest plus [`manifest.firefox.json`](../manifest.firefox.json) | Firefox/Zen event page |

Both packages contain the same `background.js`, `content.js`, and `popup.js`
bundles. The manifests select the background environment. Bundling resolves
source imports before installation, so each environment loads one classic
script and registers its listeners synchronously.

The Firefox override replaces whole top-level manifest fields. Shared
permissions, content scripts, icons, and version stay in the base manifest.
Firefox-specific settings declare a stable add-on ID, Firefox 142 minimum,
and no data collection. This baseline supports Mozilla's built-in
data-collection declaration across Firefox variants; there is no maximum
version cap. Keep the add-on ID stable after publication.

The extension uses common Manifest V3 APIs under `chrome.*` with promises.
[Firefox supports this namespace and promise behavior](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).
If an API needs different behavior between browsers, handle it at its call
site and cover it with an integration test. Add shared features to the module
that owns the behavior.

After rebuilding a locally loaded extension, reload it from the browser's
extension manager and refresh the stream. The extension reload applies
manifest and permission changes; the page refresh replaces the running
content monitor. See the [README](../README.md#development) for commands.

## Validation

`npm test` builds both packages and checks source and test types. Pure rule
tests import source modules directly. Integration tests execute the built
scripts with browser and DOM mocks from `test/helpers`, so the assertions in
each test file describe behavior without embedding the entire browser setup.
The shared test clock advances timers without waiting for real time.

Background tests load each package's declared entry point, then recreate the
context while preserving storage and alarms. They cover mute ownership,
navigation, repeated API failures, release retries, and queued cleanup.
Content tests use the real detector and timing rules with simulated player
controls. Popup tests cover saved settings, live synchronization, and
overlapping refreshes.

Build checks verify the background type, referenced assets, and classic
script syntax. Mozilla's `addons-linter` validates the Firefox package with
warnings treated as errors. Real-stream release checks in the README cover
browser behavior and MLB.TV markup that the automated tests simulate.
