# Changelog

This file records notable changes by extension version. Early versions were not
tagged, so their entries are reconstructed from commits that changed the
recorded version.

## 0.2.2 - 2026-07-25

### Fixed

- Kept popup state synchronized with the on-page status through stream
  transitions and navigation.

### Changed

- Replaced ambiguous player-state wording in the popup and on-page diagnostics
  with video-interface wording.

## 0.2.1 - 2026-07-25

### Changed

- Clarified the Chrome Web Store summary to describe commercial-break
  detection without the ambiguous phrase "player states".

## 0.2.0 - 2026-07-24

### Added

- Added extension icons with artwork sized for better toolbar visibility.
- Added integration, recovery, boundary, and transition tests across the
  detector, content monitor, background worker, mute policy, and popup.

### Changed

- Migrated the extension from JavaScript to strict TypeScript compiled into
  `dist`.
- Renamed the product to Ad Muter for MLB.TV.
- Simplified internal state, names, diagnostic history, and clipboard handling.
- Reworked public documentation for open-source and Chrome Web Store
  publication.

### Fixed

- Serialized extension-wide mute release and tab cleanup with other per-tab
  work.
- Reported missing player audio as unavailable instead of audible.

## 0.1.10 - 2026-07-24

- Preserved an established ad mute across supported stream reloads.

## 0.1.9 - 2026-07-24

- Retried unacknowledged tab mutes with bounded backoff.

## 0.1.8 - 2026-07-24

- Added configurable on-page overlay positions.

## 0.1.7 - 2026-07-24

- Kept the overlay accurate across fullscreen changes and extension reloads.

## 0.1.4 - 2026-07-24

- Reconciled Chrome's current tab mute state during ad pods.

## 0.1.3 - 2026-07-24

- Added the initial local commercial-break detector, tab-mute policy, popup,
  diagnostics, and automated tests.
