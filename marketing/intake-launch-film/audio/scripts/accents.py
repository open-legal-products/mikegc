"""Strong accents in the film's music (trimmed seconds): onsets whose level
jumps by at least 5 dB, ranked by jump, plus the analysis's confirmed chords.

    python3 -I accents.py <music_dir> <out.json>
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

music = Path(sys.argv[1])
an = json.loads((music / "analysis.json").read_text())
trim = an["first_note"]["trim_offset_s"]
y, sr = sf.read(music / "moonlight_iii.wav", dtype="float64", always_2d=True)
y = y.mean(axis=1)[int(trim * sr): int((trim + 66) * sr)].astype(np.float32)
hop = 128
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, n_mels=128)
fr = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop, units="frames", delta=0.04, wait=4)
rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
db = 20 * np.log10(rms + 1e-9)
acc = []
for f in fr:
    before = db[max(0, f - 16): max(1, f - 2)].mean()
    after = db[f + 1: f + 12].max()
    jump = float(after - before)
    if jump >= 5:
        acc.append({"t": round(float(librosa.frames_to_time(f, sr=sr, hop_length=hop)), 3), "jump_db": round(jump, 1),
                    "peak_db": round(float(after), 1)})
confirmed = []
for w in an["waves"]:
    confirmed += [w["chord1"], w["chord2"]]
confirmed += [an["bars_9_14_accents"]["bar9_downbeat_confirmed"]["t_trimmed"]]
confirmed += [e["t_trimmed"] for e in an["splice_candidates"]["events"] if e.get("accented_in_score") or e.get("is_downbeat")]
confirmed += [e["t_trimmed"] for e in an["splice_candidates_60_70"]["events"] if e.get("accented_in_score") or e.get("is_downbeat")]
confirmed += [22.234, 22.901, 25.051, 31.12, 31.36]  # bar 14 staccato and fermata sf, bar 15, wave 7 chords
Path(sys.argv[2]).write_text(json.dumps({"accents": acc, "confirmed": sorted(set(round(c, 3) for c in confirmed))}, indent=1))
for a in acc:
    print(f'{a["t"]:7.3f}  jump {a["jump_db"]:5.1f}  peak {a["peak_db"]:6.1f}')
