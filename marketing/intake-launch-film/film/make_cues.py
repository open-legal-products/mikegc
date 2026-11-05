"""Write cues.json: the film's beat schedule plus the music's measured landmarks.

Film time 0 is the music's trimmed start (its first note at 0.01 s). The
channel logos land on accented chords and the end card cuts on a downbeat,
both read from audio/music/analysis.json; the rest is a fixed schedule.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
audio = Path(sys.argv[1])
an = json.loads((audio / "music" / "analysis.json").read_text())

waves = {x["wave"]: x for x in an["waves"]}
bar9 = an["bars_9_14_accents"]["bar9_downbeat_confirmed"]["t_trimmed"]
# Gmail and Outlook on wave 4's two chords (one email channel, two providers),
# Slack on wave 5's first chord, Teams on bar 9's forte downbeat.
chords = [waves[4]["chord1"], waves[4]["chord2"], waves[5]["chord1"], bar9]

# The end card: cut just before bar 37's downbeat (where bar 36's trill
# resolves), into bar 199's downbeat, and end when the final chord has rung
# out 6.0 s later.
bar37 = next(e for e in an["splice_candidates_60_70"]["events"] if e["bar"] == 37 and e["beat"] == 1)
endcard = round(bar37["t_trimmed"] - 0.01, 3)
ending = an["ending"]["proposal"]
seg = ending["exact_6s_variant"]["end_file_s"] - ending["exact_6s_variant"]["cut_in_file_s"]

# Every cut, entrance and click lands on something you can hear: a measured
# accent (an onset whose level jumps by 5 dB or more), a chord or downbeat the
# analysis confirmed, or a beat of the score-aligned grid.
music = audio / "music"
acc = json.loads((music / "accents.json").read_text())
grid = json.loads((music / "beat_grid.json").read_text())
EVENTS = sorted(set([a["t"] for a in acc["accents"]] + acc["confirmed"] + [b["t"] for b in grid["beats"]]))


def hit(t, tol=0.12):
    best = min(EVENTS, key=lambda e: abs(e - t))
    assert abs(best - t) <= tol, f"no musical event within {tol}s of {t} (nearest {best})"
    return round(best, 3)


hits = {
    # Beat 4: the Slack thread rises on bar 11's accent; Jordan's message on bar 12;
    # MikeGC's reply on the strong accent at 20.1; the request page on the bar-14 fermata chord.
    "thread": hit(17.80), "jordan": hit(18.83), "ack": hit(20.11), "request": hit(22.91),
    "subject": hit(23.475), "documents": hit(24.275), "punch": hit(25.05),
    "requester": hit(25.5, 0.2), "deadline": hit(25.92), "created": hit(26.68),
    # Beat 5: rules on wave 6's first chord, the rule's glow on its second; the toast on wave 7.
    "rules": hit(27.93), "rule": hit(28.146), "queue": hit(30.75), "toast": hit(31.12), "open": hit(32.43),
    "activity": hit(33.36), "note": hit(34.01), "doc": hit(36.22), "redline": hit(36.77),
    # Beat 6: the requester loop.
    "ask": hit(37.88), "askClick": hit(39.69), "thread2": hit(40.92), "question": hit(41.55), "reply": hit(42.44),
    "newReply": hit(43.49), "resolveTyped": hit(44.59), "resolveClick": hit(45.48), "dialog": hit(45.69),
    "resolve": hit(46.97), "thread3": hit(47.65), "resolution": hit(48.06),
    # The email scenario, through bars 29-34.
    "email": hit(48.92), "emailMsg": hit(49.13), "emailAck": hit(50.05), "emailRequest": hit(50.76),
    "emailGlow": hit(51.25), "process": hit(52.57), "composer": hit(53.48), "send": hit(54.27),
    "chat": hit(54.78), "changes": hit(56.19), "view": hit(57.82), "dpa": hit(58.22), "dpaGlow": hit(58.67),
    # Beat 7: the dashboard from bar 35; counts, then the workload.
    "dashboard": hit(59.90), "counts": hit(60.36), "overdue": hit(60.77), "workload": hit(61.69), "load": hit(62.61),
}

cues = {
    "music_start_file_s": an["first_note"]["trim_offset_s"],
    "music_ending_in_file_s": ending["cut_in_file_s"],
    "chords": chords,
    # Beat 1: General Legal's logo, "sponsors", then the Mike mark lands on
    # wave 1's chords (2.90 s and 3.11 s), "GC" types on and the mark turns blue.
    "glIn": 0.3,
    "sponsorsIn": 1.35,
    "swap": round(waves[1]["chord1"] - 0.15, 2),
    "mikeIn": round(waves[1]["chord1"], 2),
    "gcType": round(hit(4.219) - 0.18, 3),   # "G" on bar 3's third beat, "C" just after
    "subIn": hit(5.008),                      # the subtitle on bar 4's downbeat
    # Beat 2: the wordmark lifts on the accent at 7.96; "Intake" lands on wave 3's chord.
    "b2": hit(7.96),
    "featureIn": round(hit(7.96) + 0.15, 3),
    "intakeIn": round(hit(9.38) - 0.55, 3),
    "b2out": round(waves[4]["chord1"] - 0.25, 3),
    # Beat 3: the messages slide into the queue.
    "queueIn": hit(15.87),
    # at[3]..at[7] start beat 4, beat 5, beat 6, the email scenario and beat 7.
    "at": [0.0, 7.25, 12.04, 18.05, 28.1, 38.0, 48.2, 58.0],
    # Beat 4: highlights on the request page.
    "g4": {"subject": 23.09, "requester": 24.02, "deadline": 25.07, "documents": 25.89},
    "hits": hits,
    "endcard": endcard,
    "end": round(endcard + seg, 3),
}
(ROOT / "cues.json").write_text(json.dumps(cues, indent=2) + "\n")
print(json.dumps(cues, indent=1))
