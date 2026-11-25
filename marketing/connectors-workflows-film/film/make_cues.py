"""Write cues.json: the film's beat schedule, snapped to the music.

The film uses the intake launch film's music edit: Moonlight III from bar 1 to
just before bar 37's downbeat, then bar 199 to the end. Film time 0 is the
music's trimmed start. Every cut, entrance and click lands on something you
can hear: a measured accent (an onset whose level jumps by 5 dB or more), a
chord or downbeat the analysis confirmed, or a beat of the score-aligned grid.

    python3 make_cues.py <audio-dir>    # the intake film's audio/ (music/*.json)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
audio = Path(sys.argv[1])
music = audio / "music"
an = json.loads((music / "analysis.json").read_text())
acc = json.loads((music / "accents.json").read_text())
grid = json.loads((music / "beat_grid.json").read_text())
EVENTS = sorted(set([a["t"] for a in acc["accents"]] + acc["confirmed"] + [b["t"] for b in grid["beats"]]))
waves = {x["wave"]: x for x in an["waves"]}


def hit(t, tol=0.12):
    best = min(EVENTS, key=lambda e: abs(e - t))
    assert abs(best - t) <= tol, f"no musical event within {tol}s of {t} (nearest {best})"
    return round(best, 3)


# The end card: as in the intake film, cut just before bar 37's downbeat into
# bar 199's, and end when the final chord has rung out.
bar37 = next(e for e in an["splice_candidates_60_70"]["events"] if e["bar"] == 37 and e["beat"] == 1)
endcard = round(bar37["t_trimmed"] - 0.01, 3)
ending = an["ending"]["proposal"]
seg = ending["exact_6s_variant"]["end_file_s"] - ending["exact_6s_variant"]["cut_in_file_s"]

hits = {
    # Beat 3: the nine connector logos land on waves 4 and 5's chords, bar 9's forte
    # chord and the accents of bar 10, then gather into one card.
    "logos": [hit(t) for t in (10.99, 11.21, 12.63, 12.89, 13.20, 14.15, 14.37, 14.57, 15.42)],
    "gather": hit(15.87),
    # Beat 4: Settings > Connectors from bar 11.
    "settings": hit(17.80), "savedFor": hit(18.83), "discover": hit(19.67), "addClick": hit(20.11),
    "added": hit(20.94), "gmailClick": hit(22.25), "gmail": hit(22.91), "approvalRow": hit(25.05), "writeTools": hit(26.68),
    # Beat 5: the Assistant uses them; the approval lands on wave 7's chord.
    "chat": hit(27.92), "prompt": hit(28.15), "steps": hit(30.0), "approval": hit(31.12), "approveMove": hit(32.43),
    "approve": hit(33.36), "sent": hit(34.01), "mail": hit(36.22), "mailMsg": hit(36.77),
    # Beat 6: the workflows library from bar 23.
    "chapter": hit(37.88), "chapterWord": hit(38.63), "list": hit(40.92), "gcRows": hit(41.55),
    "detail": hit(43.49), "detailZoom": hit(44.18),
    # Beat 7: a quick action, bars 27 to 31.
    "home": hit(45.67), "quick": hit(46.29), "qaClick": hit(46.97), "picker": hit(47.65), "confirm": hit(48.48),
    "composer": hit(48.92), "send": hit(50.05), "result": hit(50.75), "table": hit(51.25), "doc": hit(52.56), "docGlow": hit(53.47),
    # Beat 8: the catalog in the open, then the recap, into the end card.
    "repo": hit(54.26), "repoRows": hit(54.78), "repoGlow": hit(56.18), "recap": hit(58.22), "recapCaption": hit(58.67),
    "quickLabels": hit(59.90),
}

cues = {
    "music_start_file_s": an["first_note"]["trim_offset_s"],
    "music_ending_in_file_s": ending["cut_in_file_s"],
    # Beat 1: "Feature demo" on bar 2's accent, the MikeGC wordmark on wave 1's first
    # chord, the subtitle on bar 4's downbeat; everything lifts on the accent at 7.96.
    "eyebrowIn": hit(1.29), "mikeIn": round(waves[1]["chord1"], 3), "subIn": hit(5.008), "b2": hit(7.96),
    # Beat 2: "In this demo", then "Connectors" and "& Workflows" on wave 3's two chords.
    "featureIn": round(hit(7.96) + 0.15, 3), "word1": round(waves[3]["chord1"], 3), "word2": round(waves[3]["chord2"], 3),
    "b2out": round(waves[4]["chord1"] - 0.25, 3),
    "hits": hits,
    "endcard": endcard,
    "end": round(endcard + seg, 3),
}
(ROOT / "cues.json").write_text(json.dumps(cues, indent=2) + "\n")
print(json.dumps(cues, indent=1))
