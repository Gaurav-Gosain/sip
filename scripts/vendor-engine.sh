#!/bin/sh
# Copy a built webterm worker engine into static/engine.
#
# Usage: scripts/vendor-engine.sh /path/to/webterm
#
# The engine is webterm's engine/ directory (branch feat/worker-engine until
# it merges). Build it there first: engine/ghostty.sh, then engine/build.sh.
# Only the files the browser loads are copied, plus the NOTICE.
set -eu
src="${1:?usage: scripts/vendor-engine.sh /path/to/webterm}/engine"
dst="$(cd "$(dirname "$0")/.." && pwd)/static/engine"
[ -f "$src/dist/engine.wasm" ] || { echo "vendor-engine: $src/dist/engine.wasm is missing. Build the engine first." >&2; exit 1; }
mkdir -p "$dst"
for f in client.js worker.js net-worker.js transport.js transports.js input.js keys.js webterm-compat.js; do
  cp "$src/src/$f" "$dst/$f"
done
cp "$src/dist/engine.wasm" "$dst/engine.wasm"
cp "$src/NOTICE" "$dst/NOTICE"
# The page imports the WebTerm-shaped wrapper under sip's name for it.
cp "$dst/webterm-compat.js" "$dst/engine-webterm.js" && rm "$dst/webterm-compat.js"
# The record engine_vendor_test.go holds the copies to.
root="$(cd "$(dirname "$0")/.." && pwd)"
commit="$(git -C "$src" rev-parse HEAD)"
{
  printf '{\n  "repository": "https://github.com/Gaurav-Gosain/webterm",\n  "path": "engine",\n  "commit": "%s",\n  "files": {\n' "$commit"
  first=1
  for f in $(cd "$dst" && ls | sort); do
    [ "$first" = 1 ] || printf ',\n'
    first=0
    printf '    "%s": "%s"' "$f" "$(sha256sum "$dst/$f" | cut -d' ' -f1)"
  done
  printf '\n  }\n}\n'
} > "$root/engine-vendor.json"
echo "vendored ${commit} into $dst"
