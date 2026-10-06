import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
type BuiltManifest = Omit<typeof import("../manifest.json"), "background"> & {
  background: { service_worker?: string; scripts?: string[] };
};

for (const buildDirectory of ["dist", "dist-firefox"]) {
  const dist = path.join(import.meta.dirname, "..", buildDirectory);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, "manifest.json"), "utf8")
  ) as BuiltManifest;

  test(`${buildDirectory}: keeps package and extension versions in sync`, () => {
    assert.equal(manifest.version, packageMetadata.version);
  });

  test(`${buildDirectory}: uses the target browser's background entry point`, () => {
    assert.equal(manifest.manifest_version, 3);
    if (buildDirectory === "dist") {
      assert.equal(manifest.background.service_worker, "src/background.js");
      assert.equal(manifest.background.scripts, undefined);
    } else {
      assert.equal(manifest.background.service_worker, undefined);
      assert.deepEqual(manifest.background.scripts, [
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
    const popup = fs.readFileSync(
      path.join(dist, manifest.action.default_popup),
      "utf8"
    );
    for (const match of popup.matchAll(/(?:src|href)="([^"]+)"/g)) {
      referencedFiles.push(path.join(path.dirname(manifest.action.default_popup), match[1]));
    }

    for (const file of referencedFiles) {
      assert.equal(
        fs.existsSync(path.join(dist, file)),
        true,
        `Missing built extension file: ${file}`
      );
      if (file.endsWith(".js")) {
        // A classic extension entry point cannot contain unresolved ESM imports.
        const source = fs.readFileSync(path.join(dist, file), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
      }
    }
  });
}
