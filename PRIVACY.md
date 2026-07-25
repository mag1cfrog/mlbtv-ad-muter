# Privacy

Baseball Break Muter processes a small set of player-control signals locally in
the browser to distinguish normal playback from a possible commercial break.

The extension:

- Does not transmit data to the developer or any third party.
- Does not use analytics, telemetry, advertising, or remote code.
- Does not read cookies, login credentials, media URLs, streaming manifests, or
  account information.
- Does not persist game, viewing, advertising, or browsing history.
- Stores only the user's auto-mute and on-page-overlay preferences in local
  extension storage.
- Holds the current detection and mute state plus the 40 most recent detector
  or tab-mute transitions in session-only extension storage. Mute sources are
  recorded only as this extension, another extension, the user, tab capture, or
  unknown; other extension IDs are not stored. This local diagnostic history is
  cleared when the browser session ends and can be copied manually from the
  popup for troubleshooting.

The supported site receives no additional requests from the extension.
