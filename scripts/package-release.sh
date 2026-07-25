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
archive="$release_dir/mlbtv-ad-muter-$package_version.zip"

mkdir -p "$release_dir"
rm -f "$archive"
(cd "$root/dist" && zip -qr "$archive" .)

echo "Created $archive"
