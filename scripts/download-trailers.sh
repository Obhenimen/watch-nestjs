#!/usr/bin/env bash
# Download every youtubeTrailerId from enriched-movies.json into public/trailers/<id>.mp4.
# Requires yt-dlp (https://github.com/yt-dlp/yt-dlp). For browser-safe MP4, prefer remux after: npm run trailers:remux
#
# If downloads fail with HTTP 403, update yt-dlp and/or use browser cookies:
#   yt-dlp --cookies-from-browser chrome ...
# See https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/trailers"

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not found. Install: brew install yt-dlp" >&2
  exit 1
fi

mkdir -p "$OUT"
cd "$ROOT"

count=$(node -e "
const j = require('./src/database/enriched-movies.json');
const ids = [...new Set(j.map((m) => m.youtubeTrailerId).filter(Boolean))];
console.log(ids.length);
")
echo "Downloading up to ${count} trailer(s) into ${OUT} (skips files that already exist)"

node -e "
const j = require('./src/database/enriched-movies.json');
const ids = [...new Set(j.map((m) => m.youtubeTrailerId).filter(Boolean))].sort();
for (const id of ids) console.log(id);
" | while read -r id; do
  [[ -n "$id" ]] || continue
  dest="$OUT/${id}.mp4"
  if [[ -f "$dest" ]]; then
    echo "Skip (exists): $id"
    continue
  fi
  echo "Fetching: $id"
  if ! yt-dlp --no-playlist --no-warnings \
    -f "bv*[height<=1080]+ba/bv*[height<=1080]/b" \
    --merge-output-format mp4 \
    -S "vcodec:h264,res:1080,acodec:aac" \
    -o "$OUT/${id}.%(ext)s" \
    "https://www.youtube.com/watch?v=${id}"; then
    echo "Warning: failed $id" >&2
  fi
done

echo "Done. If videos do not play in the browser, run: npm run trailers:remux"
