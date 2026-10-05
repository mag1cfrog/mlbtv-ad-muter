# Ad Muter for MLB.TV

<p align="center">
  <img
    src="store-assets/promotional/small-promo-440x280.png"
    alt="Hear the game. Mute the breaks."
    width="440"
  >
</p>

<p align="center">
  <strong>No telemetry. No remote code. Zero runtime dependencies.</strong>
</p>

Ad Muter for MLB.TV is a local-only extension for Chrome, Firefox, and Zen
that mutes the browser tab during detected commercial breaks, then restores
audio when game content returns.

Commercials keep playing. The extension does not block requests, skip content,
modify the stream, or interact with authentication, subscriptions, blackouts,
or DRM.

## Install

### Chrome Web Store

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ad-muter-for-mlbtv/alombkoifhmcejnfgcdgdphlgpdllodc).

### Build locally

Requires Node.js 22.18 or newer.

1. Run `npm ci`.
2. Run `npm run build`.

The build creates `dist` for Chrome and `dist-firefox` for Firefox and Zen.

### Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the generated `dist` directory.

### Load in Firefox or Zen

Requires Firefox 142 or newer, or a Zen release based on Firefox 142 or newer.

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `dist-firefox/manifest.json`.

Temporary add-ons are removed when the browser restarts. For a permanent
installation, the Firefox package must be
[signed by Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/),
either for a public listing or for self-distribution. The local build and
release ZIP are unsigned.

## Use

1. Open a stream at `https://www.mlb.com/tv/`.
2. Open the extension popup and confirm the detected playback state.
3. Enable **Automatically mute breaks**.

Auto-muting is off by default. The optional on-page status overlay can be
enabled from the popup.

## Why trust it?

- Site access is limited to MLB.TV stream pages.
- Detection checks MLB.TV's on-screen video interface for controls such as
  play, volume, captions, and settings. It does not inspect video frames,
  audio, cookies, or account data.
- Settings and bounded diagnostics stay in browser extension storage.
- No data is sent to the developer or any third party.
- Existing user mute choices and manual unmute overrides are respected.
- The extension contains no third-party runtime code.

See the complete [privacy statement](PRIVACY.md).

## Development

```bash
npm ci
npm test
```

`npm test` builds both packages, checks types, runs the full test suite, and
validates the Firefox package with Mozilla's `addons-linter`. Background
integration tests load each package's real entry point and exercise mute ownership,
manual overrides, background restart, navigation, alarm retries, and cleanup.
CI runs the same command on pull requests. Build and validation tools are development
dependencies; the compiled extension has no third-party runtime dependencies
or bundler.

Run `npm run package:release` to test, build, and write separate versioned
`-chrome.zip` and `-firefox.zip` packages to `release/`.

After changing extension files, rebuild the project, reload the unpacked
extension, and reload the stream tab.

Before releasing, test an actual MLB.TV stream in Chrome and Firefox or Zen:
enable auto-mute, watch a break and the return to game content, manually
unmute during a break, toggle auto-mute off, and check the overlay in
fullscreen. Automated tests use simulated player controls and browser APIs.

## Documentation

- [Changelog](CHANGELOG.md)
- [Architecture](docs/architecture.md)
- [Privacy](PRIVACY.md)

## Limitations

Detection depends on the layout and labels of MLB.TV's on-screen video
interface and may require updates when the website changes.

This is an independent, unofficial project. It is not affiliated with or
endorsed by Major League Baseball, MLB.TV, any team, or any broadcaster.

## License

[MIT](LICENSE)
