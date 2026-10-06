import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const firefoxDist = path.join(root, "dist-firefox");
const tsc = path.join(
  path.dirname(require.resolve("typescript/package.json")), "bin", "tsc"
);

// esbuild bundles the imports; TypeScript remains responsible for type checking.
execFileSync(process.execPath, [tsc], { cwd: root, stdio: "inherit" });
fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(firefoxDist, { recursive: true, force: true });
buildSync({
  absWorkingDir: root,
  entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts"],
  outdir: path.join(dist, "src"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  loader: { ".css": "text" }
});

for (const asset of ["popup.html", "popup.css", "icons"]) {
  fs.cpSync(path.join(root, "src", asset), path.join(dist, "src", asset), {
    recursive: true
  });
}
fs.copyFileSync(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
fs.cpSync(dist, firefoxDist, { recursive: true });
const firefoxManifest = {
  ...require("../manifest.json"),
  ...require("../manifest.firefox.json")
};
fs.writeFileSync(
  path.join(firefoxDist, "manifest.json"),
  JSON.stringify(firefoxManifest, null, 2) + "\n"
);
