# Architecture

Ad Muter for MLB.TV is a Manifest V3 Chrome extension written in TypeScript.
It compiles to plain JavaScript without a bundler or third-party runtime code.

## Runtime flow

1. `content.ts` observes semantic controls in the MLB.TV player.
   `detector.ts` classifies the controls, and `timing-policy.ts` prevents brief
   transitions from becoming stable states.
2. The content monitor sends each new detector state to the background worker.
3. `background.ts` serializes events per tab and asks `mute-policy.ts` whether
   to mute, hold, or release. It is the only component that changes tab audio.
4. The background worker stores diagnostics, updates the badge, and returns the
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
| [`popup.ts`](../src/popup.ts) | Settings and diagnostic presentation |

Policy files hold testable decisions. The content, background, and popup files
coordinate browser APIs.

## State and safety

- `chrome.storage.local` keeps the `enabled`, `showOverlay`, and
  `overlayPosition` settings.
- `chrome.storage.session` keeps one bounded diagnostic record per tab.
- The background worker checks Chrome's current mute state before changing it
  and only releases a mute owned by this extension.
- A manual unmute is respected for the rest of the current ad pod.
- Disabling auto-mute or leaving a supported stream releases an
  extension-owned mute.

## Build

`npm run build` compiles TypeScript and copies the manifest and static assets
into `dist`, which can be loaded as an unpacked extension. Shared policies are
loaded as ordered scripts, so no bundler is needed.
