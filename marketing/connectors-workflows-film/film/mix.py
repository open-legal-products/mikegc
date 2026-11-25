"""Build the film's soundtrack from the music and cues.json.

The movement plays from its first note until the end-card cut, then cuts on
a downbeat to its final bars and ends when the last chord has rung out.
There is no voiceover; the music plays at its own dynamics throughout.
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
ROOT = Path(__file__).resolve().parent
cues = json.loads((ROOT / "cues.json").read_text())
audio = Path(sys.argv[1])  # holds music/
out = Path(sys.argv[2])

full, sr = sf.read(audio / "music" / "moonlight_iii.wav", always_2d=True, dtype="float64")
assert sr == SR, sr

E = cues["endcard"]
END = cues["end"]
n_end = int(round(END * SR))
start = cues["music_start_file_s"]        # film t=0: 10 ms before the first note
cut_in = cues["music_ending_in_file_s"]   # bar 199 beat 1, 10 ms before its attack
e = int(round(E * SR))
xf = int(0.02 * SR)

music = np.zeros((n_end, 2))
s0 = int(round(start * SR))
music[: e + xf] += full[s0: s0 + e + xf]
# 20 ms equal-power splice: out of the opening just before bar 32's downbeat,
# into the ending on bar 199's downbeat.
music[e: e + xf] *= np.cos(np.linspace(0, np.pi / 2, xf))[:, None]
c0 = int(round(cut_in * SR))
tail = full[c0: c0 + (n_end - e)].copy()
tail[:xf] *= np.sin(np.linspace(0, np.pi / 2, xf))[:, None]
music[e: e + len(tail)] += tail

# The last 120 ms: a short release so the final chord does not click off.
r = int(0.12 * SR)
music[-r:] *= np.linspace(1, 0, r)[:, None] ** 2
music *= 10 ** (-1.0 / 20) / (np.max(np.abs(music)) + 1e-9)
sf.write(out, music, SR, subtype="PCM_24")
print("wrote", out, f"{n_end / SR:.3f}s")
