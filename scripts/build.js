"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const tsc = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "bin",
  "tsc"
);

fs.rmSync(dist, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [tsc],
  { cwd: root, stdio: "inherit" }
);
fs.copyFileSync(
  path.join(root, "manifest.json"),
  path.join(dist, "manifest.json")
);
fs.cpSync(path.join(root, "src"), path.join(dist, "src"), {
  recursive: true,
  filter: (source) => !/\.[jt]s$/.test(source)
});
