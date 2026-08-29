#!/usr/bin/env bash
# Packages the built extension into the two ZIPs the website hands out.
#
# The site is a static deploy with no release step behind it, so the archives
# live in site/downloads/ and are committed. Rebuild them with `npm run
# package` whenever anything under WebsiteTimeTrack/ changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/WebsiteTimeTrack/dist"
OUT="$ROOT/site/downloads"

VERSION=$(node -p "require('$ROOT/WebsiteTimeTrack/manifest.json').version")

bash "$ROOT/WebsiteTimeTrack/build.sh" >/dev/null

rm -rf "$OUT"
mkdir -p "$OUT"

# The archives are committed, so two runs on an unchanged tree should produce
# the same bytes -- otherwise every build turns into a diff. A ZIP stores each
# entry's mtime and the order it was fed in, so both get pinned here.
find "$DIST" -exec touch -t 200001010000.00 {} +

cd "$DIST"
for target in chrome firefox; do
    find "$target" -type f | LC_ALL=C sort |
        zip -q -X -D "$OUT/websitetimetrack-$target.zip" -@
done

cd "$OUT"
sha256sum websitetimetrack-*.zip > SHA256SUMS.txt

echo "v$VERSION"
sed 's/^/  /' SHA256SUMS.txt
