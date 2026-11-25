#!/usr/bin/env bash
# Build the connectors and workflows film: soundtrack, picture, then the final file.
#   ./build.sh <audio-dir> <out-dir>
# <audio-dir> is the intake film's audio/ (music/moonlight_iii.wav and its analysis).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AUDIO="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"

python3 "$HERE/make_cues.py" "$AUDIO" > /dev/null
python3 "$HERE/mix.py" "$AUDIO" "$OUT/mix.wav"

# Loudness: two-pass EBU R128 to -16 LUFS integrated, -1.5 dBTP.
measure=$(ffmpeg -hide_banner -nostats -i "$OUT/mix.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$measure" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -hide_banner -loglevel error -i "$OUT/mix.wav" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):linear=true,aresample=48000" \
  -c:a pcm_s24le "$OUT/mix_norm.wav"

node "$HERE/render.cjs" video 16x9 "$OUT/picture_16x9.mp4" --workers 3
# 2–3% grain on luma so the silver gradient doesn't band after compression.
ffmpeg -y -hide_banner -loglevel error -i "$OUT/picture_16x9.mp4" -i "$OUT/mix_norm.wav" \
  -vf "noise=c0s=5:c0f=t+u,format=yuv420p" \
  -c:v libx264 -preset slow -crf 18 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -r 30 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest \
  "$OUT/MikeGC_Connectors_Workflows_16x9.mp4"
echo "built $OUT/MikeGC_Connectors_Workflows_16x9.mp4"
