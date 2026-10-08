#!/bin/sh
# Write a WOFF2 copy of every TTF in static/fonts.
#
# The conversion is lossless: fontTools changes the container, not the
# glyphs, tables or features. The page asks for the WOFF2 first and keeps the
# TTF as the fallback for a browser without WOFF2. Run it after a font
# changes. compress_test.go fails when a TTF has no WOFF2.
#
# Needs python3 with fontTools and brotli (pip install fonttools brotli).
set -eu
dir=$(cd "$(dirname "$0")/../static/fonts" && pwd)
for ttf in "$dir"/*.ttf; do
	python3 -I -c '
import sys
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[1])
font.flavor = "woff2"
font.save(sys.argv[2])
' "$ttf" "${ttf%.ttf}.woff2"
	echo "wrote ${ttf%.ttf}.woff2"
done
