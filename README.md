# Baseball Break Muter

Baseball Break Muter is an experimental, local-only Chrome extension that
detects a commercial-break player layout and can mute the browser tab until
normal playback controls return.

Commercials continue playing. The extension does not block requests, skip
content, modify the stream, or interact with authentication, subscriptions,
blackouts, or DRM.

## Current status

The detector uses a commercial-control marker confirmed during a live
inning-break transition, with semantic player-control differences as a
fallback. It defaults to **observation mode**, so installing it does not change
audio until the user explicitly enables auto-muting.

This is an independent, unofficial project. It is not affiliated with or
endorsed by Major League Baseball, MLB.TV, any team, or any broadcaster.

## Local installation

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select this repository's `dist` directory.
7. Open the extension popup while viewing a supported stream.
8. Confirm that the detected state is accurate before enabling auto-muting.

After changing extension files, run `npm run build`, click **Reload** on the
unpacked extension card, and reload the supported stream tab.

Reloading an unpacked extension invalidates content scripts already running in
open tabs. The old monitor stops and shows **RELOAD PAGE** when the on-page
overlay is enabled, rather than leaving a stale detector status visible.

## Diagnostics

Expand **Local diagnostics** in the popup to inspect the ten most recent
transitions or copy the full session record. The extension retains at most 40
transitions in session-only storage. The record contains detector signals and
mute decisions plus the category responsible for actual tab mute changes, but
no other extension IDs, media URLs, account data, cookies, or video content.
It also records whether the player controller itself is muted, which is
separate from Chrome's tab-level mute.

Enable **Show on-page status** for an optional, noninteractive indicator in the
selected corner of the supported player page. The popup offers top-left,
top-right, bottom-left, and bottom-right positions, with bottom-right as the
default:

- Green: stable game content
- Orange: commercial state and tab mute status
- Gray: unknown state
- Pulsing blue: candidate transition, including raw and stable classifications

The overlay is disabled by default, isolated in a Shadow DOM, and uses
`pointer-events: none` so it cannot intercept player interaction.
When the player enters fullscreen, the overlay is moved inside either the
browser Fullscreen API element or MLB's CSS fullscreen wrapper, then returned
to the document root on exit. Only the player wrapper's `class` attribute is
observed for this transition.

The mute state machine deliberately ignores short candidate and unknown
transitions after a commercial is confirmed. Audio is restored only after game
controls remain stable for two seconds, or immediately when auto-muting is
disabled or the page navigates.

Chrome's current tab mute state is authoritative; cached ownership is never
enough to skip a mute operation. If an extension-originated unmute occurs while
the stable state is still `ad`, the background worker repairs it. A manual
Chrome tab unmute is respected for the remainder of the current ad pod, while
the next content-to-ad transition enables automatic muting again.
Each detector request now returns Chrome's confirmed tab-audio state directly
to the page monitor. If a stable commercial state remains audible because that
request or acknowledgment failed, the monitor retries after 500 milliseconds
and backs off to at most one retry every 1.5 seconds until mute is confirmed.
If the supported stream page enters a loading state between adjacent ads, an
established ad mute remains latched through navigation. Navigation away from a
supported stream still releases the extension-owned mute, and stable game
content remains the normal signal that ends an ad mute.

The explicit commercial-controls marker is confirmed for 300 milliseconds.
The weaker minimal-controls fallback is confirmed for 900 milliseconds.
Player DOM changes trigger checks through a narrowly scoped observer, with a
1.5-second periodic watchdog as a fallback.

## Development

TypeScript is compiled with `tsc` into a loadable extension in `dist`. No
bundler or third-party runtime dependencies are required.

```text
npm install
npm test
```

`npm test` builds the extension before running the test suite.

Important files:

- `src/detector.ts`: player-state signal collection and pure classification logic
- `src/overlay-policy.ts`: normal and fullscreen overlay placement
- `src/timing-policy.ts`: asymmetric detector timing policy
- `src/content.ts`: DOM observation and transition hysteresis
- `src/mute-policy.ts`: pure mute-state decision policy
- `src/background.js`: safe tab muting and restoration
- `docs/research-notes.md`: observed player-state evidence
- `PRIVACY.md`: local data-handling statement

## Safety boundaries

- Supported-site access is limited to the MLB.TV path.
- Detection uses player control state, not video or audio content.
- Auto-muting is opt-in and reversible.
- A tab that was muted before a break remains muted afterward.
- Diagnostic transitions are session-only and bounded to 40 entries.
- No data leaves the browser.

## License

MIT
