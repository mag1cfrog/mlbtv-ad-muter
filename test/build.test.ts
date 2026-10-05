"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const packageMetadata = require("../package.json") as typeof import(
  "../package.json"
);
type BuiltManifest = Omit<typeof import("../manifest.json"), "background"> & {
  background: { service_worker?: string; scripts?: string[] };
};

for (const buildDirectory of ["dist", "dist-firefox"]) {
  const dist = path.join(__dirname, "..", buildDirectory);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, "manifest.json"), "utf8")
  ) as BuiltManifest;

  test(`${buildDirectory}: keeps package and extension versions in sync`, () => {
    assert.equal(manifest.version, packageMetadata.version);
  });

  test(`${buildDirectory}: uses the target browser's background entry point`, () => {
    assert.equal(manifest.manifest_version, 3);
    if (buildDirectory === "dist") {
      assert.equal(manifest.background.service_worker, "src/background-worker.js");
      assert.equal(manifest.background.scripts, undefined);
    } else {
      assert.equal(manifest.background.service_worker, undefined);
      assert.deepEqual(manifest.background.scripts, [
        "src/mute-policy.js",
        "src/overlay-policy.js",
        "src/background.js"
      ]);
    }
  });

  test(`${buildDirectory}: builds every file referenced by the manifest`, () => {
    const backgroundFiles = manifest.background.service_worker
      ? [manifest.background.service_worker]
      : manifest.background.scripts || [];
    assert.ok(backgroundFiles.length);
    const referencedFiles = [
      ...backgroundFiles,
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
}
