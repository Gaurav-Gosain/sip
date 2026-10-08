#!/bin/sh
# Build webterm from a checkout and vendor its script-tag bundles into static/.
#
# Usage: scripts/vendor-webterm.sh /path/to/webterm
#
# The checkout must be clean, so that the commit written to webterm-vendor.json
# is the source of the files. vendor_test.go checks the files against that
# record, so a bundle copied by hand without running this fails the Go tests.
set -eu

if [ $# -ne 1 ]; then
	echo "usage: $0 /path/to/webterm" >&2
	exit 2
fi
src=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/.." && pwd)

if [ -n "$(git -C "$src" status --porcelain)" ]; then
	echo "vendor-webterm: $src has uncommitted changes. Commit them first." >&2
	exit 1
fi

(cd "$src" && npm run build >/dev/null)

cp "$src/dist/webterm.standalone.global.js" "$root/static/webterm.js"
cp "$src/dist/webterm-vtgl.standalone.global.js" "$root/static/webterm-vtgl.js"
cp "$src/dist/webterm.css" "$root/static/webterm.css"
cp "$src/node_modules/@xterm/xterm/css/xterm.css" "$root/static/xterm.css"

commit=$(git -C "$src" rev-parse HEAD)
# The vtgl checkout webterm built webterm-vtgl.js against. It is a file:
# dependency, so the commit comes from the checkout the link points at.
vtgl=$(cd "$src/node_modules/@gaurav-gosain/vtgl" && pwd -P)
if [ -n "$(git -C "$vtgl" status --porcelain)" ]; then
	echo "vendor-webterm: $vtgl has uncommitted changes. Commit them first." >&2
	exit 1
fi
vtgl_commit=$(git -C "$vtgl" rev-parse HEAD)
node - "$src" "$root" "$commit" "$vtgl_commit" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [src, root, commit, vtglCommit] = process.argv.slice(2);
const pkg = (p) => JSON.parse(readFileSync(join(src, p, 'package.json'), 'utf8'));
const files = {};
for (const name of ['webterm.js', 'webterm-vtgl.js', 'webterm.css', 'xterm.css']) {
  files[name] = createHash('sha256').update(readFileSync(join(root, 'static', name))).digest('hex');
}
const record = {
  repository: 'https://github.com/Gaurav-Gosain/webterm',
  commit,
  version: pkg('.').version,
  xterm: pkg('node_modules/@xterm/xterm').version,
  vtgl: pkg('node_modules/@gaurav-gosain/vtgl').version,
  vtglRepository: 'https://github.com/Gaurav-Gosain/vtgl',
  vtglCommit,
  files,
};
writeFileSync(join(root, 'webterm-vendor.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`vendored webterm ${commit}`);
NODE
