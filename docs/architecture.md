# Architecture

Ad Muter for MLB.TV is a Manifest V3 extension for Chrome, Firefox, and Zen,
written in TypeScript. It compiles to plain JavaScript without a bundler or
third-party runtime code.

## Runtime flow

1. `content.ts` observes semantic controls in the MLB.TV player.
   `detector.ts` classifies the controls, and `timing-policy.ts` prevents brief
   transitions from becoming stable states.
2. The content monitor sends each new detector state to the background script.
3. `background.ts` serializes events per tab and asks `mute-policy.ts` whether
   to mute, hold, or release. It is the only component that changes tab audio.
4. The background script stores diagnostics, updates the badge, and returns the
   confirmed tab-audio state to the content monitor.
5. `popup.ts` reads the active tab state and writes user settings.

Candidate and unknown states do not immediately restore audio. Stable game
content ends an extension-owned mute.

## Source boundaries

| File | Responsibility |
| --- | --- |
| [`types.d.ts`](../src/types.d.ts) | Shared messages, settings, policies, and stored-record types |
| [`detector.ts`](../src/detector.ts) | Player signals and classification |
| [`timing-policy.ts`](../src/timing-policy.ts) | Confirmation and retry delays |
| [`mute-policy.ts`](../src/mute-policy.ts) | Mute decisions and mute-source classification |
| [`overlay-policy.ts`](../src/overlay-policy.ts) | Overlay position and fullscreen mounting |
| [`content.ts`](../src/content.ts) | DOM observation, state stabilization, retries, and overlay rendering |
| [`background.ts`](../src/background.ts) | Tab audio, event ordering, navigation, diagnostics, and badges |
| [`background-worker.ts`](../src/background-worker.ts) | Chrome service-worker startup and dependency loading |
| [`popup.ts`](../src/popup.ts) | Settings and diagnostic presentation |

Policy files hold testable decisions. The content, background, and popup files
coordinate browser APIs.

## State and safety

- `chrome.storage.local` keeps the `enabled`, `showOverlay`, and
  `overlayPosition` settings.
- `chrome.storage.session` keeps one bounded diagnostic record per tab.
- The background script checks the browser's current mute state before
  changing it and only releases a mute owned by this extension.
- A manual unmute is respected for the rest of the current ad pod.
- Disabling auto-mute or leaving a supported stream releases an
  extension-owned mute.

## Browser compatibility

Chrome runs `background-worker.ts`, which synchronously loads the policies
and shared background script with `importScripts`. Firefox and Zen use an
event page and load the same scripts in manifest order. All event listeners
are registered synchronously when the background starts. Both environments
can unload while idle, so settings and tab state live in extension storage.
The in-memory queues only order work within the current background context.

The extension uses the common Manifest V3 APIs under `chrome.*` with promises.
[Firefox supports this namespace and promise behavior](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).
New API usage should work in both supported browsers and pass Firefox
validation. Detection, mute policy, content scripts, and the popup are shared.

## Build and validation

`npm run build` compiles once and creates two packages:

| Package | Manifest | Background environment |
| --- | --- | --- |
| `dist` | [`manifest.json`](../manifest.json) | Chrome service worker |
| `dist-firefox` | Base manifest plus [`manifest.firefox.json`](../manifest.firefox.json) | Firefox/Zen event page |

The Firefox override replaces whole top-level fields. Shared permissions,
content scripts, icons, and version stay in the base manifest.
Firefox-specific settings declare a stable add-on ID, a
Firefox 142 minimum, and no data collection. This baseline supports Mozilla's
built-in data-collection declaration across Firefox variants; there is no
maximum version cap. Keep the add-on ID stable after publication so updates
retain the same identity.

Keep browser-specific startup in the loader and manifest override. Add
features to the shared source files. If a future API needs different behavior
between browsers, handle that difference at its call site and cover it with
an integration test.

`npm test` builds both packages, checks types, executes the real Chrome and
Firefox background entry points in isolated test contexts, and runs Mozilla's
`addons-linter` with warnings treated as errors. The lifecycle test also
recreates each background context while preserving session storage to check
mute recovery after an idle unload. The real-stream release checks in the
README cover browser behavior and MLB.TV markup that these tests simulate.
