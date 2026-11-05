"""A beat grid for the film's music: every quarter-note beat of bars 1-44 on the
trimmed timeline, from the score alignment, snapped to the nearest measured
onset, with each beat's onset strength and level jump (for ranking accents).

    python3 -I beat_grid.py <music_dir> <out.json>
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

music = Path(sys.argv[1])
out = Path(sys.argv[2])
al = json.loads((music / "score_alignment.json").read_text())
an = json.loads((music / "analysis.json").read_text())
trim = an["first_note"]["trim_offset_s"]

TPB, BAR, RES, HOP = al["tpb"], al["bar_ticks"], al["score_res_ticks"], al["frame_hop_s"]
path = np.array(al["path"])  # [score_frame, audio_frame]


def tick_time(tick):
    """Median audio time the alignment gives a score tick (trimmed seconds)."""
    f = tick / RES
    near = path[np.abs(path[:, 0] - f) <= 0.5]
    if not len(near):
        i = np.argmin(np.abs(path[:, 0] - f))
        near = path[i:i + 1]
    return float(np.median(near[:, 1])) * HOP


y, sr = sf.read(music / "moonlight_iii.wav", dtype="float64", always_2d=True)
y = y.mean(axis=1)[int(trim * sr): int((trim + 75) * sr)]
hop = 256
oenv = librosa.onset.onset_strength(y=y.astype(np.float32), sr=sr, hop_length=hop, n_mels=128)
peaks = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop, units="frames", delta=0.05)
ptimes = librosa.frames_to_time(peaks, sr=sr, hop_length=hop)
pstr = oenv[peaks] / np.percentile(oenv[peaks], 95)
rms = librosa.feature.rms(y=y.astype(np.float32), frame_length=1024, hop_length=hop)[0]
rms_db = 20 * np.log10(rms + 1e-9)


def level_jump(t):
    i = int(t * sr / hop)
    before = rms_db[max(0, i - 8): max(1, i - 1)].mean()
    after = rms_db[i + 1: i + 6].max()
    return float(after - before)


# Measured times the analysis already confirmed (waves' chords, bar 9, splice points).
confirmed = {}
for w in an["waves"]:
    confirmed.setdefault("chords", []).extend([w["chord1"], w["chord2"]])
known = sorted(set(confirmed["chords"] + [an["bars_9_14_accents"]["bar9_downbeat_confirmed"]["t_trimmed"]]
                   + [e["t_trimmed"] for e in an["splice_candidates"]["events"]]
                   + [e["t_trimmed"] for e in an["splice_candidates_60_70"]["events"]]))

beats = []
for bar in range(1, 45):
    for q in range(4):
        tick = (bar - 1) * BAR + q * TPB
        t0 = tick_time(tick)
        if t0 > 66:
            continue
        # Snap to a confirmed time, else to the strongest measured onset nearby.
        k = min(known, key=lambda x: abs(x - t0))
        if abs(k - t0) < 0.09:
            t, how = k, "confirmed"
        else:
            near = np.where(np.abs(ptimes - t0) < 0.09)[0]
            if len(near):
                j = near[np.argmax(pstr[near])]
                t, how = float(ptimes[j]), "onset"
            else:
                t, how = t0, "score"
        i = np.argmin(np.abs(ptimes - t))
        strength = float(pstr[i]) if abs(ptimes[i] - t) < 0.03 else 0.0
        beats.append({"bar": bar, "beat": q + 1, "t": round(t, 3), "how": how,
                      "strength": round(strength, 2), "jump_db": round(level_jump(t), 1)})

out.write_text(json.dumps({"time_base": "trimmed seconds (film time)", "beats": beats}, indent=1))
for b in beats:
    if b["beat"] in (1, 3):
        print(f'{b["bar"]:>3}.{b["beat"]} {b["t"]:7.3f} {b["how"]:9s} str {b["strength"]:4.2f} jump {b["jump_db"]:5.1f}')
