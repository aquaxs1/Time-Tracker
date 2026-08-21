#!/usr/bin/env bash
# Builds one loadable folder each for Chrome and Firefox into dist/.
# The only difference is the manifest – the code runs unchanged in both.
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
echo "Chrome:  chrome://extensions -> Developer mode -> Load unpacked -> dist/chrome"
echo "Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> dist/firefox/manifest.json"
