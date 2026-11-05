# MikeGC Intake launch film

The source for the 60-second film that announces MikeGC and shows Intake,
built from the launch video script (Nov 5, 2026). Everything on screen is
rendered from code: the product shots are the real frontend captured with
demo data, and the titles, channel logos and chat thread are an HTML
composition rendered frame by frame. Nothing here ships with the app.

The rendered films are build output and are not committed. Rebuild them with
the steps below.

## What's in the film

| Beat | Time | On screen |
| --- | --- | --- |
| 1. Sponsor | 0:00 | General Legal mark, *sponsors*, the MikeOSS logo, then "GC" types on and the mark turns MikeGC blue |
| 2. Feature | 0:07 | The wordmark moves to the corner; *Its first feature* / **Intake** |
| 3. Channels | 0:10 | Gmail, Outlook, Slack and Teams land on the music's accented chords; their messages slide into one *Intake · Outstanding* card |
| 4. Capture | 0:18 | Jordan's @MikeGC message and MikeGC's reply in the thread, then the request page and its Details sidebar |
| 5. Triage and first pass | 0:28 | The NDA rule, the **New Intake Request** toast, MikeGC's note in Activity, and *Acme_NDA.docx* with MikeGC's tracked changes |
| 6. Requester loop | 0:38 | **Ask requester**, the question and Jordan's reply in the thread, the queue's new-reply marker, **Resolve request**, and the redline posted back |
| 7. Oversight | 0:48 | The dashboard: counts, the weekly chart and the workload table |
| 8. End card | 0:54 | MikeGC / Intake / *Open source. Built for in-house legal.* / URL / *Sponsored by GENERAL LEGAL, LLP* |

`film/cues.json` holds the exact times: the voiceover line starts, the four
chord landings, the word-level highlight cues, the end-card splice and the
film's length. `film/make_cues.py` derives them from the voiceover's word
timings and the music analysis, and `film/captions.srt` is a closed-caption
sidecar for the voiceover (the on-screen labels are burned in).

## Where it departs from the script

- **Beat 3's chords.** In the recording, waves 1–3 last two bars each, waves 4
  and 5 one bar each, and bars 9–14 are a pedal passage without paired chords,
  so four waves don't fit between 0:10 and 0:18. Gmail and Outlook land on the
  two chords that end wave 4 (0:10.99 and 0:11.21), which also shows them as two
  routes into one email channel. Slack lands on wave 5's chords (0:12.63) and
  Teams on the forte chord on bar 9's downbeat (0:13.20). The voiceover starts so
  "Slack" and "Teams" are spoken as those logos land.
- **The music edit.** The opening plays from bar 1 to just before bar 32's
  downbeat (0:54.25), then cuts to bar 199's downbeat. The film ends when the
  final chord has decayed, at 1:00.25.
- **Ducking.** Under the product beats the music sits about 16 dB below full
  while a line is spoken and comes up between lines, so the bed doesn't vanish
  in the gaps.
- **"Message requester".** The current app asks the requester from the
  request's **Messages** panel, with an **Ask requester** button, so the film
  shows that. (`docs/intake.md` still says **Message requester** in the note
  box.)
- **The Slack thread** is a neutral chat thread with the Slack logo, not a
  recording of Slack's own interface. MikeGC's lines use the wording the Slack
  adapter actually posts (`backend/src/modules/intake/intake.slack.ts`):
  "Logged for Legal: Review Acme's NDA. Assigned to Priya Shah.", and a
  member's question and resolution post under their name with the APP badge.
- **The voiceover** is a synthetic scratch track (Kokoro-82M, voice
  `af_heart`), cut to time. Replace it with a recorded narrator before
  release.

## Open questions from the script

These are still open; the film currently does what the script proposes.

- The mark changes from MikeOSS black to the MikeGC blue mark.
- The voiceover says "Its first feature is Intake."
- The end-card URL is `github.com/open-legal-products/mikegc`. Change it in
  `film/cues.json` (`"url"`).

## Rebuilding

Requires Node 22, Python 3 with `numpy` and `soundfile`, ffmpeg, and
Playwright's Chromium.

1. **Product shots.** Start the frontend (`npm run dev --prefix frontend -- -p 3100`;
   no backend is needed), then run `node capture/capture.cjs`. It signs in a
   fictional member, answers every `/api` call from `capture/mock.cjs`, and
   writes `capture/shots/*.png` (1600 × 1000 at 2×) with `shots.json`.
   Run `python3 capture/make_docx.py capture/docx/Acme_NDA.docx` first: it
   writes the NDA with MikeGC's tracked changes that the document viewer shows.
2. **Assets.** `film/fetch-assets.sh` copies the logos and fonts from this
   repository, downloads the General Legal mark from general.legal and Google's
   Gmail logo from Wikimedia Commons, and links the shots.
3. **Audio.** `audio/fetch-music.sh` downloads the recording and converts it
   to `audio/music/moonlight_iii.wav`; `audio/music/analysis.json` holds its
   measured wave chords, bar downbeats and the splice points. The voiceover
   goes in `audio/vo/` as `vo01.wav`…`vo07.wav` with `vo.json` (durations and
   word timings). `voiceover/make_vo.py audio/vo` regenerates the scratch
   track (see `voiceover/requirements.txt`); a recorded narrator's files can
   replace it as long as `vo.json` gets their durations and word timings.
4. **Build.** `film/build.sh audio <out>` derives the cues, mixes the
   soundtrack (two-pass loudness to -16 LUFS, -1.5 dBTP), renders the 16:9
   master and the 1:1 and 9:16 cutdowns, and writes
   `MikeGC_Intake_launch_<format>.mp4` with `MikeGC_Intake_launch.srt`.
   `node film/render.cjs stills 16x9 3,12.5,40` renders single frames for
   review.

## Demo data

One workspace, "Legal", with three lawyers (Priya Shah, Sam Ortiz, Dana Kim),
40 requests over eight weeks, and fictional requesters at Acme, Brightwater
and Harbor & Pine. Email addresses use `example.com`. No real person, client
or document appears.

## Credits

- **Music:** Beethoven, Piano Sonata No. 14, III. Presto agitato, performed by
  Paul Pitman, courtesy of Musopen. Public domain (recording released by the
  performer; Wikimedia Commons `File:Moonlight_Sonata_Presto.ogg`, VRT ticket
  2008012110017088). The audio used is the 256 kbps original of the same
  recording at archive.org (`MoonlightSonata_845`).
- **Fonts:** Inter and EB Garamond, SIL Open Font License (`frontend/src/app/fonts/`).
- **Scratch voiceover:** Kokoro-82M v1.0 and its `af_heart` voice
  (Apache-2.0), with misaki for pronunciation (Apache-2.0).
- **Logos:** Gmail, Outlook, Slack and Teams are their owners' trademarks,
  shown unmodified as channels Intake works with. The General Legal mark is
  used with the sponsor's approval (pending).
