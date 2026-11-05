#!/usr/bin/env bash
# Build the launch film: soundtrack, picture for each format, then the final files.
#   ./build.sh <audio-dir> <out-dir> [formats...]
# <audio-dir> holds music/ (moonlight_iii.wav, analysis.json) and vo/ (vo.json, vo0N.wav).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AUDIO="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
shift 2
FORMATS=("$@")
[ "$#" -eq 0 ] && FORMATS=(16x9 1x1 9x16)

python3 "$HERE/make_cues.py" "$AUDIO" > /dev/null
node "$HERE/render.cjs" timing 16x9 > /dev/null
python3 "$HERE/mix.py" "$AUDIO" "$OUT/mix.wav"
cp "$HERE/captions.srt" "$OUT/MikeGC_Intake_launch.srt"

# Loudness: two-pass EBU R128 to -16 LUFS integrated, -1.5 dBTP.
measure=$(ffmpeg -hide_banner -nostats -i "$OUT/mix.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$measure" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["input_i"])')
mtp=$(echo "$measure" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["input_tp"])')
mlra=$(echo "$measure" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["input_lra"])')
mth=$(echo "$measure" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["input_thresh"])')
ffmpeg -y -hide_banner -loglevel error -i "$OUT/mix.wav" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:linear=true,aresample=48000" \
  -c:a pcm_s24le "$OUT/mix_norm.wav"

for f in "${FORMATS[@]}"; do
  node "$HERE/render.cjs" video "$f" "$OUT/picture_$f.mp4" --workers 3
  # 2–3% grain on luma so the silver gradient doesn't band after compression.
  ffmpeg -y -hide_banner -loglevel error -i "$OUT/picture_$f.mp4" -i "$OUT/mix_norm.wav" \
    -vf "noise=c0s=5:c0f=t+u,format=yuv420p" \
    -c:v libx264 -preset slow -crf 18 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -r 30 \
    -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest \
    "$OUT/MikeGC_Intake_launch_$f.mp4"
  echo "built $OUT/MikeGC_Intake_launch_$f.mp4"
done
