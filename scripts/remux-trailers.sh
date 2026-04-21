#!/usr/bin/env bash
# Remux trailer files to real MP4 (ISO BMFF) so browsers can play them.
# The repo's yt-dlp defaults often produce MPEG-TS with a .mp4 name.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/public/trailers"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install with: brew install ffmpeg" >&2
  exit 1
fi

shopt -s nullglob
for f in "$DIR"/*.mp4; do
  tmp="${f%.mp4}.remuxing.mp4"
  echo "Remuxing: $(basename "$f")"
  if ! ffmpeg -hide_banner -loglevel error -y -fflags +genpts -i "$f" \
    -map 0 -c copy -bsf:a aac_adtstoasc -movflags +faststart "$tmp" 2>/dev/null; then
    ffmpeg -hide_banner -loglevel error -y -fflags +genpts -i "$f" \
      -map 0 -c copy -movflags +faststart "$tmp"
  fi
  mv "$tmp" "$f"
done

echo "Done. Restart the API and open e.g. http://localhost:3000/trailers/EP34Yoxs3FQ.mp4"
