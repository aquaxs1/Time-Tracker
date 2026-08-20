#!/usr/bin/env bash
# Baut je einen ladbaren Ordner fuer Chrome und Firefox nach dist/.
# Unterschied ist allein das Manifest – der Code laeuft in beiden Browsern.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SRC/dist"

SHARED=(background.js content.js popup.html popup.js options.html options.js
        blocked.html blocked.js styles.css icon16.png icon48.png icon128.png)

rm -rf "$OUT"

for target in chrome firefox; do
    dir="$OUT/$target"
    mkdir -p "$dir/lib"

    for file in "${SHARED[@]}"; do
        cp "$SRC/$file" "$dir/$file"
    done
    cp "$SRC"/lib/*.js "$dir/lib/"

    if [ "$target" = "chrome" ]; then
        cp "$SRC/manifest.json" "$dir/manifest.json"
    else
        cp "$SRC/manifest.firefox.json" "$dir/manifest.json"
    fi

    echo "$target -> $dir"
done

echo
echo "Chrome:  chrome://extensions -> Entwicklermodus -> Entpackte Erweiterung laden -> dist/chrome"
echo "Firefox: about:debugging -> Dieser Firefox -> Temporaeres Add-on laden -> dist/firefox/manifest.json"
