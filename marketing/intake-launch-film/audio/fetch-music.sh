#!/usr/bin/env bash
# Download the public-domain recording (Paul Pitman for Musopen) and convert it
# to the 48 kHz, 24-bit WAV that analysis.json's times refer to.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mp3="$(mktemp -d)/presto.mp3"
curl -fsSL -o "$mp3" \
  "https://archive.org/download/MoonlightSonata_845/Sonata_no_14_in_c_sharp_minor_moonlight_op_27_no_2_Iii.Presto.mp3"
echo "f4c1ffd284507f31f39a5d371e0be5f6133289af  $mp3" | sha1sum -c -
ffmpeg -y -hide_banner -loglevel error -i "$mp3" -af aresample=resampler=soxr -ar 48000 -c:a pcm_s24le "$HERE/music/moonlight_iii.wav"
echo "wrote $HERE/music/moonlight_iii.wav"
