#!/usr/bin/env bash
# Checks that the ZIPs the website hands out are the current extension.
#
# They are committed rather than built on deploy, so nothing else would notice
# if a source change never made it into the archive and visitors kept
# downloading a stale build. Contents are compared, not bytes -- two zip
# versions can pack the same tree differently.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/WebsiteTimeTrack/dist"
OUT="$ROOT/site/downloads"

bash "$ROOT/WebsiteTimeTrack/build.sh" >/dev/null

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

status=0

for target in chrome firefox; do
    zip="$OUT/websitetimetrack-$target.zip"
    if [ ! -f "$zip" ]; then
        echo "::error::$zip is missing -- run npm run package"
        status=1
        continue
    fi
    unzip -qq "$zip" -d "$tmp/$target"
    if diff -r "$DIST/$target" "$tmp/$target/$target" >"$tmp/$target.diff"; then
        echo "$target zip matches the build"
    else
        echo "::error::websitetimetrack-$target.zip is stale -- run npm run package"
        sed 's/^/  /' "$tmp/$target.diff"
        status=1
    fi
done

# The page quotes these, so a wrong line there is a failed integrity check for
# anyone who bothers to run it.
if ! (cd "$OUT" && sha256sum -c --status SHA256SUMS.txt); then
    echo "::error::SHA256SUMS.txt does not match the archives -- run npm run package"
    status=1
fi

# A visitor reads the version off the download page before trusting the file.
WANT=$(node -p "require('$ROOT/WebsiteTimeTrack/manifest.json').version")
if ! grep -q "Version $WANT" "$ROOT/site/download.html"; then
    echo "::error::site/download.html does not name version $WANT"
    status=1
fi

exit $status
