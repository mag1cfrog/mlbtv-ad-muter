#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

command -v zip >/dev/null 2>&1 || {
  echo "zip is required to package the extension." >&2
  exit 1
}

npm test

package_version=$(node -p "require('./package.json').version")
release_dir="$root/release"
mkdir -p "$release_dir"

for browser in chrome firefox; do
  build_dir="dist"
  if [ "$browser" = "firefox" ]; then
    build_dir="dist-firefox"
  fi
  archive="$release_dir/mlbtv-ad-muter-$package_version-$browser.zip"
  rm -f "$archive"
  (cd "$root/$build_dir" && zip -qr "$archive" .)
  echo "Created $archive"
done
