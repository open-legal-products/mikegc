"""Derive the film's cues from the voiceover's word timings and the music analysis.

Writes cues.json (read by film.js and mix.py) and the voiceover captions as
an .srt sidecar. Film time 0 is the music's trimmed start (first note at 0.01 s).
"""
import json
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent
audio = Path(sys.argv[1])
an = json.loads((audio / "music" / "analysis.json").read_text())
vo = json.loads((audio / "vo" / "vo.json").read_text())
lines = vo["lines"]


def words(i):
    return lines[i]["words"]


def w(i, word, nth=0):
    """Start of the nth occurrence of `word` in line i, relative to the line."""
    hits = [x["start_s"] for x in words(i) if x["word"].lower().strip(".,:") == word.lower()]
    return hits[nth]


dur = [l["duration_s"] for l in lines]
waves = {x["wave"]: x for x in an["waves"]}
bar9 = an["bars_9_14_accents"]["bar9_downbeat_confirmed"]["t_trimmed"]
# Gmail and Outlook on wave 4's two chords (one email channel, two providers),
# Slack on wave 5's first chord, Teams on bar 9's forte downbeat.
chords = [waves[4]["chord1"], waves[4]["chord2"], waves[5]["chord1"], bar9]

v = [0.0] * 7
v[0] = 0.6
v[1] = round(v[0] + dur[0] + 0.16, 2)
# "Slack" lands with the Slack logo; "Teams" then falls just before bar 9.
v[2] = round(chords[2] - w(2, "slack") + 0.02, 2)
v[3] = round(v[2] + dur[2] + 0.75, 2)
v[4] = round(v[3] + dur[3] + 1.4, 2)
v[5] = round(v[4] + 9.9, 2)
v[6] = round(v[5] + 10.2, 2)

# The end card: cut on bar 32's downbeat (just before its attack) to bar 199.
bar32 = next(e for e in an["splice_candidates"]["events"] if e["bar"] == 32 and e["beat"] == 1)
endcard = round(bar32["t_trimmed"] - 0.01, 3)
ending = an["ending"]["proposal"]
seg = ending["exact_6s_variant"]["end_file_s"] - ending["exact_6s_variant"]["cut_in_file_s"]

cues = {
    "url": "github.com/open-legal-products/mikegc",
    "music_start_file_s": an["first_note"]["trim_offset_s"],
    "music_ending_in_file_s": ending["cut_in_file_s"],
    "vo": v,
    "vo_files": [l["file"] for l in lines],
    "vo_durations": dur,
    "chords": chords,
    # Beat 1: "General Legal | has sponsored | MikeOSS | to design MikeGC | : a fork of Mike…"
    "glIn": 0.25,
    "sponsorsIn": round(v[0] + w(0, "sponsored") - 0.3, 2),
    "swap": round(v[0] + w(0, "mikeoss"), 2),
    "mikeIn": round(v[0] + w(0, "mikeoss") + 0.28, 2),
    "gcType": round(v[0] + w(0, "mikegc") - 0.02, 2),
    "subIn": round(v[0] + w(0, "a") - 0.05, 2),
    # Beat 2
    "b2": round(v[1] - 0.25, 2),
    "featureIn": round(v[1] + w(1, "its") - 0.05, 2),
    "intakeIn": round(v[1] + w(1, "intake") - 0.45, 2),
    # Beat 3: the bubbles slide into the queue on "brings them into one queue".
    "queueIn": round(v[2] + w(2, "brings") - 0.1, 2),
    # Beat 4: highlights on the words.
    "g4": {
        "subject": round(v[3] + w(3, "subject") - 0.12, 2),
        "requester": round(v[3] + w(3, "requester") - 0.12, 2),
        "deadline": round(v[3] + w(3, "deadline") - 0.12, 2),
        "documents": round(v[3] + w(3, "documents") - 0.12, 2),
    },
    # Beat 7: "what's open | what's overdue | who's carrying the load"
    "d7": {
        "open": round(v[6] + w(6, "open") - 0.15, 2),
        "overdue": round(v[6] + w(6, "overdue") - 0.15, 2),
        "load": round(v[6] + w(6, "carrying") - 0.1, 2),
    },
    "endcard": endcard,
    "end": round(endcard + seg, 3),
}
(ROOT / "cues.json").write_text(json.dumps(cues, indent=2) + "\n")


def ts(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


srt = []
for i, l in enumerate(lines):
    # Split a line into cues of at most two 42-character lines, timed by its words.
    ws = l["words"]
    script = l["text_script"].split()
    assert len(script) == len(ws), (l["file"], len(script), len(ws))
    chunks, cur = [], []
    for j, word in enumerate(script):
        trial = " ".join([script[k] for k in cur] + [word])
        if cur and len(textwrap.wrap(trial, 42)) > 2:
            # Break after the last punctuation in the chunk when there is one.
            cut = max((n for n, k in enumerate(cur[:-1]) if script[k][-1] in ".,:"), default=None)
            if cut is None:
                chunks.append(cur)
                cur = []
            else:
                chunks.append(cur[: cut + 1])
                cur = cur[cut + 1:]
        cur.append(j)
    chunks.append(cur)
    for c, idx in enumerate(chunks):
        a = v[i] + ws[idx[0]]["start_s"]
        b = v[i] + (ws[chunks[c + 1][0]]["start_s"] - 0.05 if c + 1 < len(chunks) else dur[i] + 0.2)
        if i + 1 < len(lines):
            b = min(b, v[i + 1] - 0.05)
        text = "\n".join(textwrap.wrap(" ".join(script[k] for k in idx), 42))
        srt.append(f"{len(srt) + 1}\n{ts(a)} --> {ts(b)}\n{text}\n")
(ROOT / "captions.srt").write_text("\n".join(srt))
print(json.dumps(cues, indent=1))
