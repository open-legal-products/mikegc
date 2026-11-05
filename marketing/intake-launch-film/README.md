# MikeGC Intake launch film

The source for the 70-second film that announces MikeGC and shows Intake,
built from the launch video script (Nov 5, 2026). Everything on screen is
rendered from code: the product shots are the real frontend captured with
demo data, and the titles, channel logos and chat thread are an HTML
composition rendered frame by frame. Nothing here ships with the app.

The film has no voiceover: on-screen text carries it, set to the music.
The rendered films are build output and are not committed. Rebuild them with
the steps below.

## What's in the film

| Beat | Time | On screen |
| --- | --- | --- |
| 1. Sponsor | 0:00 | General Legal's logo and *sponsors*; the MikeOSS logo, at the same size, lands on the music's first chords; "GC" types on and the mark turns MikeGC blue; *A fork of Mike for in-house legal teams* |
| 2. Feature | 0:07 | *Its first feature* / **Intake** |
| 3. Channels | 0:10 | Gmail, Outlook, Slack and Teams land on the music's accented chords; their messages slide into one *Intake · Outstanding* card |
| 4. Capture | 0:18 | Jordan's @MikeGC message and MikeGC's reply in the thread, then the request page and its Details sidebar |
| 5. Triage and first pass | 0:28 | The NDA rule, the **New Intake Request** toast, MikeGC's note in Activity, and *Acme_NDA.docx* with MikeGC's tracked changes |
| 6. Requester loop | 0:38 | **Ask requester**, the question and Jordan's reply in the thread, the queue's new-reply marker, **Resolve request**, and the redline posted back |
| 7. By email | 0:48 | Maya's email to legal@example.com and MikeGC's "Logged for Legal" reply; the request *Created by MikeGC from Gmail*; **Process in Assistant** opens the Assistant with the request attached; its analysis, three tracked changes to *Brightwater_DPA.docx*, and the redlined DPA |
| 8. Oversight | 0:58 | The dashboard: counts, the weekly chart and the workload table |
| 9. End card | 1:03 | The MikeGC wordmark, with *Sponsored by* and General Legal's logo beneath it |

`film/cues.json` holds the exact times: the beat schedule, the four chord
landings, the highlight cues, the end-card splice and the film's length
(1:09.55).
`film/make_cues.py` writes it from the music analysis and the schedule.

## Where it departs from the script

- **No voiceover**, no corner mark between the opening and the end card, and
  no "not legal advice" footnote. The end card has no Intake title, tagline or
  URL.
- **An email scenario** (beat 7) follows the Slack one: a request recorded from
  the Gmail intake mailbox, processed in the Assistant, which reviews the DPA
  and makes its changes as tracked changes in Priya's name, as the app signs
  an Assistant edit with the person who asked for it. The film runs about 70
  seconds as a result.
- **Beat 3's chords.** In the recording, waves 1–3 last two bars each, waves 4
  and 5 one bar each, and bars 9–14 are a pedal passage without paired chords,
  so four waves don't fit between 0:10 and 0:18. Gmail and Outlook land on the
  two chords that end wave 4 (0:10.99 and 0:11.21), which also shows them as two
  routes into one email channel. Slack lands on wave 5's chords (0:12.63) and
  Teams on the forte chord on bar 9's downbeat (0:13.20).
- **The music edit.** The opening plays from bar 1 to just before bar 37's
  downbeat (1:03.55), where bar 36's trill resolves, then cuts to bar 199's
  downbeat. The film ends when the final chord has decayed, at 1:09.55. With
  no voiceover the music plays at its own dynamics throughout.
- **"Message requester".** The current app asks the requester from the
  request's **Messages** panel, with an **Ask requester** button, so the film
  shows that. (`docs/intake.md` still says **Message requester** in the note
  box.)
- **The Slack thread** is a neutral chat thread with the Slack logo, not a
  recording of Slack's own interface. MikeGC's lines use the wording the Slack
  adapter actually posts (`backend/src/modules/intake/intake.slack.ts`):
  "Logged for Legal: Review Acme's NDA. Assigned to Priya Shah.", and a
  member's question and resolution post under their name with the APP badge.

## Open questions from the script

- The mark changes from MikeOSS black to the MikeGC blue mark.
- *Its first feature* introduces Intake.

## Rebuilding

Requires Node 22, Python 3 with `numpy` and `soundfile`, ffmpeg, and
Playwright's Chromium.

1. **Product shots.** Start the frontend (`npm run dev --prefix frontend -- -p 3100`;
   no backend is needed), then run `node capture/capture.cjs`. It signs in a
   fictional member, answers every `/api` call from `capture/mock.cjs`, and
   writes `capture/shots/*.png` (1600 × 1000 at 2×) with `shots.json`.
   Run `python3 capture/make_docx.py capture/docx/Acme_NDA.docx` and
   `python3 capture/make_docx.py capture/docx/Brightwater_DPA.docx dpa` first:
   they write the NDA with MikeGC's tracked changes and the DPA with Priya's,
   which the document viewer shows.
2. **Assets.** `film/fetch-assets.sh` copies the logos and fonts from this
   repository, downloads the General Legal logo from general.legal and Google's
   Gmail logo from Wikimedia Commons, and copies the shots.
3. **Music.** `audio/fetch-music.sh` downloads the recording and converts it
   to `audio/music/moonlight_iii.wav`; `audio/music/analysis.json` holds its
   measured wave chords, bar downbeats and splice points.
4. **Build.** `film/build.sh audio <out>` writes the cues, builds the
   soundtrack (two-pass loudness to -16 LUFS, -1.5 dBTP), renders the 16:9
   master and the 1:1 and 9:16 cutdowns, and writes
   `MikeGC_Intake_launch_<format>.mp4`. `node film/render.cjs stills 16x9 3,12.5,40`
   renders single frames for review.

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
- **Logos:** Gmail, Outlook, Slack and Teams are their owners' trademarks,
  shown unmodified as channels Intake works with. The General Legal logo is
  used with the sponsor's approval (pending).
