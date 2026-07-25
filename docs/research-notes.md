# Player research notes

Observation date: July 24, 2026

## Confirmed content-state signals

The live player exposed a stable wrapper:

- `.mlbtv-media-player[aria-label="Media Player"]`
- One descendant `<video>` element

The normal game-content state exposed semantic controls with these accessible
names:

- `Go to Live point`
- `Rewind 10 seconds`
- `Pause` or `Play`
- `Fast forward 10 seconds`
- `Mute` or `Unmute`
- `Broadcast selector`
- `Quality and caption settings`
- `Watch Full Screen`
- A `slider` named `Seek slider`

Generated styled-component class names were observed but intentionally excluded
from the detector because they are more likely to change.

## Confirmed commercial-state signals

One live inning-break transition was observed directly on July 24, 2026. During
the commercial, the controls wrapper changed from:

- `.mlbtv-media-controls`

to:

- `.mlbtv-media-controls.mlbtv-media-controls--ads-controls`

The commercial state contained two visible buttons, `Pause` and `Mute`, plus a
hidden volume slider. The seek slider, live-point button, rewind/fast-forward,
broadcast selector, quality settings, and fullscreen button were absent.

When game content returned, the `--ads-controls` modifier disappeared and the
full control set returned. The explicit modifier is therefore the primary
commercial signal. The minimal-control layout remains a fallback.

The observed commercial state persisted across checks at 00:02:53, 00:03:05,
and 00:03:35 UTC; normal controls had returned by 00:04:00 UTC.

More transitions, archived games, alternate broadcasts, and error/loading
states still need coverage. The extension therefore continues to default to
observation mode and uses transition hysteresis before muting.

## Ad-pod transition behavior

A later live test showed that controls can flicker between individual
commercials. A candidate content transition must not restore audio while the
last stable classification is still `ad`.

The background policy now keeps the tab muted through candidate and unknown
states. It releases the mute only after `content` becomes stable, using a
two-second content hold. Detector messages are serialized per tab, and the 40
most recent decisions are retained in session-only storage for debugging.

Actual Chrome tab-mute changes are also recorded by source category: this
extension, another extension, the user, tab capture, or unknown. An optional
Shadow DOM overlay can display stable and raw detector states without
intercepting pointer input.

The player controller's mute button and Chrome's tab mute are independent
layers. Diagnostics record the player `video.muted` boolean separately. Before
muting, the background worker checks Chrome's current `mutedInfo` rather than
trusting cached ownership. An unintended extension-originated unmute is repaired
when the stable detector state remains `ad`; a user-originated tab unmute is
treated as an override for the current ad pod.

## Design boundary

The detector reads only player control elements and their semantic classes. It
does not inspect media URLs, manifests, cookies, account data, game data, or
video frames.
