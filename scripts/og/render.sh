#!/bin/sh
# Renders public/og.png (1200x630), public/apple-touch-icon.png (180x180) and public/favicon.ico (32+16) from the HTML in this
# folder with headless Chrome. Run from the repo root: sh scripts/og/render.sh
set -eu
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
shot() { # <html> <width> <height> <out>
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars \
    --force-device-scale-factor=1 --virtual-time-budget=5000 \
    --window-size="$2,$3" --screenshot="$4" "file://$DIR/$1" 2>/dev/null
}
shot og.html 1200 630 "$ROOT/public/og.png"
shot icon.html 180 180 "$ROOT/public/apple-touch-icon.png"
# favicon.ico: 32x32 and 16x16 PNGs (downscaled from the 180px render) packed as PNG-in-ICO.
TMP="$(mktemp -d)"
sips -z 32 32 "$ROOT/public/apple-touch-icon.png" --out "$TMP/32.png" >/dev/null
sips -z 16 16 "$ROOT/public/apple-touch-icon.png" --out "$TMP/16.png" >/dev/null
python3 "$DIR/make-ico.py" "$ROOT/public/favicon.ico" "$TMP/32.png" "$TMP/16.png"
rm -r "$TMP"
sips -g pixelWidth -g pixelHeight "$ROOT/public/og.png" "$ROOT/public/apple-touch-icon.png"
ls -l "$ROOT/public/og.png" "$ROOT/public/apple-touch-icon.png"
