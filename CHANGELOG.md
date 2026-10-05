# Changelog

This file records notable changes by extension version. Early versions were not
tagged, so their entries are reconstructed from commits that changed the
recorded version.

## Unreleased

### Added

- Added a Firefox and Zen package with shared detection, mute logic, and UI.
- Added separate browser startup paths, Firefox manifest validation, and
  background lifecycle tests for both packages.

### Fixed

- Kept normal muting working when a development install has not yet loaded
  the new alarms permission.
- Loaded popup settings directly from storage and synchronized detection
  with the content monitor, even when the background is unavailable.
- Preserved mute ownership when a tab lookup or unmute fails so the content
  monitor can retry restoring audio.
- Retried failed audio restoration with browser alarms after leaving a
  stream or disabling auto-mute, including across background unloads.
- Checked each package's background configuration against its target browser
  so tests reject an invalid Chrome or Firefox startup path.

## 0.2.4 - 2026-07-25

### Fixed

- Detected explicit commercial markers immediately when MLB.TV replaces the
  inner player instead of waiting for the fallback watchdog.

## 0.2.3 - 2026-07-25

### Fixed

- Muted the tab immediately when MLB.TV exposes its explicit commercial-break
  marker instead of waiting for an additional confirmation delay.

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
