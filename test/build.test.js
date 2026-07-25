"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const dist = path.join(__dirname, "..", "dist");
const manifest = require("../dist/manifest.json");

test("builds every extension file referenced by the manifest", () => {
  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((contentScript) => contentScript.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];

  for (const file of referencedFiles) {
    assert.equal(
      fs.existsSync(path.join(dist, file)),
      true,
      `Missing built extension file: ${file}`
    );
  }
});
