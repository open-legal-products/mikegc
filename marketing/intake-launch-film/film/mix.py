"""Mix the film's soundtrack from the music, the voiceover lines and cues.json.

Music: the movement from its first note until the end-card cut, then the
movement's final bars, spliced on a downbeat. Levels follow the script:
low under the first lines, full for the channels, ducked about 18 dB under
the product beats with light accents, up after the last line, full at the end.
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
ROOT = Path(__file__).resolve().parent
cues = json.loads((ROOT / "cues.json").read_text())
audio = Path(sys.argv[1])  # holds music/ and vo/
out = Path(sys.argv[2])

music_dir = audio / "music"
an = json.loads((music_dir / "analysis.json").read_text())
vo = json.loads((audio / "vo" / "vo.json").read_text())


def load(path):
    x, sr = sf.read(path, always_2d=True, dtype="float64")
    assert sr == SR, (path, sr)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x


def db(x):
    return 10 ** (x / 20)


E = cues["endcard"]
END = cues["end"]
n_end = int(round(END * SR))
T = json.loads((ROOT / "timing.json").read_text())  # film.js's derived times (toast, resolve)

full = load(music_dir / "moonlight_iii.wav")
start = cues["music_start_file_s"]        # film t=0: 10 ms before the first note
cut_in = cues["music_ending_in_file_s"]   # bar 199 beat 1, 10 ms before its attack
e = int(round(E * SR))
xf = int(0.02 * SR)
music = np.zeros((n_end, 2))
open_seg = full[int(round(start * SR)): int(round(start * SR)) + e + xf]
music[: e + xf] += open_seg
# 20 ms equal-power splice: out of the opening just before bar 32's downbeat,
# into the ending on bar 199's downbeat.
music[e: e + xf] *= np.cos(np.linspace(0, np.pi / 2, xf))[:, None]
tail = full[int(round(cut_in * SR)): int(round(cut_in * SR)) + (n_end - e)].copy()
tail[:xf] *= np.sin(np.linspace(0, np.pi / 2, xf))[:, None]
music[e: e + len(tail)] += tail

music /= np.max(np.abs(music)) + 1e-9
music *= db(-3.0)

# ---- level envelope (dB)
v = cues["vo"]
dur = cues["vo_durations"]
v_end = [v[i] + dur[i] for i in range(len(v))]
t = np.arange(n_end) / SR


def curve(keys):
    kt = np.array([k[0] for k in keys])
    kv = np.array([k[1] for k in keys])
    i = np.clip(np.searchsorted(kt, t, side="right"), 1, len(kt) - 1)
    p = np.clip((t - kt[i - 1]) / np.maximum(kt[i] - kt[i - 1], 1e-9), 0, 1)
    p = 0.5 - np.cos(np.pi * p) / 2
    return kv[i - 1] + (kv[i] - kv[i - 1]) * p


# Level between voiceover lines.
base = curve([
    (0.0, -6.5), (cues["chords"][0] - 1.1, -6.5),
    (cues["chords"][0] - 0.2, -3.0),            # the channels: full
    (v_end[2] + 0.2, -3.0),
    (v[3] - 0.5, -7.5),                         # product beats: a bed between lines
    (v_end[6] + 0.1, -7.5),
    (v_end[6] + 0.7, -1.0),                     # up after the last line
    (E, 0.0), (END, 0.0),
])
# How far the music dips under a line: a light dip under the channels line,
# about 18 dB below full under the product lines.
depth = curve([
    (0.0, 0.0), (cues["chords"][0] - 0.2, 0.0), (cues["chords"][0], 3.0),
    (v_end[2] + 0.3, 3.0), (v[3] - 0.5, 8.5), (END, 8.5),
])
# Voice activity, with a 150 ms attack and a 450 ms release.
active = np.zeros(n_end)
for a, b in zip(v, v_end):
    rise = np.clip((t - (a - 0.15)) / 0.15, 0, 1)
    fall = np.clip(1 - (t - (b + 0.05)) / 0.45, 0, 1)
    active = np.maximum(active, np.minimum(rise, fall))
active = 0.5 - np.cos(np.pi * active) / 2
env_db = base - depth * active
# Light accents: the toast, and Resolve request.
for at in (T["toast"], T["resolve"]):
    bump = np.exp(-0.5 * ((t - (at + 0.25)) / 0.28) ** 2) * 7.0
    env_db = np.minimum(env_db + bump, np.maximum(base, env_db))
music *= db(env_db)[:, None]

# ---- voiceover
voice = np.zeros((n_end, 2))
sf.write(out.with_name("stem_music.wav"), music, SR, subtype="PCM_24")
for i, line in enumerate(vo["lines"]):
    f = audio / "vo" / line["file"]
    x = load(f if f.exists() else audio / "vo" / "out" / line["file"])
    a = int(round(v[i] * SR))
    b = min(n_end, a + len(x))
    voice[a:b] += x[: b - a] * db(cues.get("vo_gain_db", 0.0))

sf.write(out.with_name("stem_voice.wav"), voice, SR, subtype="PCM_24")
mix = music + voice
# The last 120 ms: a short release so the final chord does not click off.
r = int(0.12 * SR)
mix[-r:] *= np.linspace(1, 0, r)[:, None] ** 2
peak = np.max(np.abs(mix))
if peak > db(-1.0):
    mix *= db(-1.0) / peak
sf.write(out, mix, SR, subtype="PCM_24")
print("wrote", out, f"{n_end / SR:.3f}s", "peak", f"{20*np.log10(np.max(np.abs(mix))):.2f} dBFS")
