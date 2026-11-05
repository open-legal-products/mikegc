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
    "gcType": 4.35,
    "subIn": 5.0,
    # Beat 2: "Its first feature" / "Intake", until the first logo lands.
    "b2": 6.9,
    "featureIn": 7.25,
    "intakeIn": 7.55,
    # Beat 3: the messages slide into the queue.
    "queueIn": 15.9,
    # at[3]..at[7] start beat 4, beat 5, beat 6, the email scenario and beat 7.
    "at": [0.0, 7.25, 12.04, 18.05, 28.1, 38.0, 48.2, 58.0],
    # Beat 4: highlights on the request page.
    "g4": {"subject": 23.09, "requester": 24.02, "deadline": 25.07, "documents": 25.89},
    # Beat 7: the dashboard's counts, then the workload table.
    "d7": {"open": 58.43, "overdue": 59.36, "load": 60.38},
    "endcard": endcard,
    "end": round(endcard + seg, 3),
}
(ROOT / "cues.json").write_text(json.dumps(cues, indent=2) + "\n")
print(json.dumps(cues, indent=1))
