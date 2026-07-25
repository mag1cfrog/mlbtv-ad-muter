# Ad Muter for MLB.TV

<p align="center">
  <img src="src/icons/icon-128.png" alt="Ad Muter for MLB.TV icon" width="128">
</p>

<h3 align="center">
  <strong>Mute the breaks. Hear the game.</strong>
</h3>

<p align="center">
  <strong>No telemetry. No remote code. Zero runtime dependencies.</strong>
</p>

Ad Muter for MLB.TV is a local-only Chrome extension that mutes the browser
tab during detected commercial breaks, then restores audio when game content
returns.

Commercials keep playing. The extension does not block requests, skip content,
modify the stream, or interact with authentication, subscriptions, blackouts,
or DRM.

## Install

### Chrome Web Store

Coming soon.

<!-- Add the Chrome Web Store install link here after publication. -->

### Load unpacked

Requires Node.js 22.18 or newer.

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the generated `dist` directory.

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
- Settings and bounded diagnostics stay in Chrome extension storage.
- No data is sent to the developer or any third party.
- Existing user mute choices and manual unmute overrides are respected.
- The extension contains no third-party runtime code.

See the complete [privacy statement](PRIVACY.md).

## Development

```bash
npm install
npm test
```

`npm test` builds the extension and runs the full test suite. TypeScript and
type definitions are development-only dependencies; the compiled extension
has no third-party runtime dependencies or bundler.

Run `npm run package:release` to test, build, and write a versioned Store ZIP
to `release/`.

After changing extension files, rebuild the project, reload the unpacked
extension, and reload the stream tab.

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
