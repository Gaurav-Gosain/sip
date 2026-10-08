#!/bin/sh
# Write static/fonts/<face>.woff2 from every TTF in fonts/.
#
# The TTFs in fonts/ are the source and stay outside static/, so the binary
# embeds only the WOFF2 files. The conversion is lossless: fontTools changes
# the container, not the glyphs, tables or features. Run it after a font
# changes. compress_test.go fails when a TTF in fonts/ has no WOFF2.
#
# Needs python3 with fontTools and brotli (pip install fonttools brotli).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
for ttf in "$root"/fonts/*.ttf; do
	woff2="$root/static/fonts/$(basename "${ttf%.ttf}").woff2"
	python3 -I -c '
import sys
from fontTools.ttLib import TTFont
# Keep the source modified time, so the output is the same on every run.
font = TTFont(sys.argv[1], recalcTimestamp=False)
font.flavor = "woff2"
font.save(sys.argv[2])
' "$ttf" "$woff2"
	echo "wrote $woff2"
done
