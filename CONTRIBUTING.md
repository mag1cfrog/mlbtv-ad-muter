# Contributing

Thanks for helping improve Baseball Break Muter.

## Development principles

- Keep detection and muting local to the browser.
- Do not add telemetry, remote code, account access, stream interception,
  download features, or authentication/DRM workarounds.
- Prefer semantic and accessibility attributes over generated CSS classes.
- Treat false positives conservatively: normal content should regain audio
  immediately.
- Do not include broadcast clips, screenshots, logos, credentials, cookies, or
  player manifests in issues or test fixtures.

## Before opening a pull request

Run:

```text
npm install
npm test
```

Describe which player state was tested and whether the extension was in
observation or auto-mute mode. Sanitized boolean signal reports are welcome;
page contents and viewing data are not.
