# MikeGC connectors and workflows film

The source for a 70-second feature demo of MikeGC's connectors and its
workflows library, in the style of the [Intake launch film](../intake-launch-film/README.md).
Everything on screen is rendered from code: the product shots are the real
frontend captured with demo data, and the titles, logos, mailbox and
repository card are an HTML composition rendered frame by frame. Nothing here
ships with the app.

The film has no voiceover: on-screen text carries it, set to the same music
as the Intake film. The rendered film is build output and is not committed.
Rebuild it with the steps below.

## What's in the film

| Beat | Time | On screen |
| --- | --- | --- |
| 1. Title | 0:00 | *Feature demo*; the MikeGC wordmark lands on the music's first chord; *For in-house legal teams* |
| 2. The two features | 0:08 | *In this demo* / **Connectors & Workflows**, one word on each of wave 3's chords |
| 3. Connectors | 0:10.7 | Google Drive, Gmail, Google Calendar, CourtListener, Slack, Notion, Linear, Airtable and Lawve land on the music's chords and accents, then gather into a *Connectors · Installed* card |
| 4. Settings | 0:17.8 | Settings > Connectors: Installed, saved for the Alia workspace; Linear added from Discover; Gmail's Manage dialog, with **Ask for permission for write actions** on and the tools marked **Write** |
| 5. In the Assistant | 0:27.9 | Priya asks for the Harbor & Pine MSA's liability cap under California law and an email to Tom. The Assistant searches and reads Drive, searches case law and checks its citations on CourtListener, then asks to approve **Send email**; approved, the email is sent from Priya's Gmail and arrives in Tom's inbox |
| 6. The library | 0:37.9 | *The MikeGC workflows library* / **Workflows**; the Workflows page with its eight workflows, the three MikeGC contract workflows highlighted; Contract Markup's instructions |
| 7. A quick action | 0:45.7 | **Contract Markup** from the Assistant's Quick actions, the MSA picked from the library, the change table, and the copy redlined at section 11 |
| 8. In the open | 0:54.3 | The `open-legal-products/mikegc-workflows` repository: the eight workflow folders, their authors and licences |
| 9. Recap | 0:58.2 | The connectors and the workflows side by side; the quick actions marked on bar 35 |
| 10. End card | 1:03.55 | The MikeGC wordmark, with *Sponsored by* and General Legal's logo beneath it |

## Timed to the music

The film uses the Intake film's music edit (Moonlight III from bar 1 to just
before bar 37's downbeat, then bar 199 to the final chord) and its analysis
in `../intake-launch-film/audio/music/`. `film/make_cues.py` snaps every
planned moment to the nearest measured accent, confirmed chord or downbeat,
or beat of the score-aligned grid, and fails if none is within 0.12 seconds.
`film/cues.json` holds the result. For example:

| Moment | Time | In the music |
| --- | --- | --- |
| The MikeGC wordmark | 0:02.90 | Wave 1's first chord |
| *Connectors*, then *& Workflows* | 0:09.37, 0:09.60 | Wave 3's two chords |
| The nine logos | 0:10.99–0:15.42 | Waves 4 and 5's chords, bar 9's forte chord, bar 10's accents |
| Gmail's Manage dialog | 0:22.91 | The fermata chord in bar 14 |
| The Assistant | 0:27.92 | Wave 6's first chord |
| The approval | 0:31.12 | Wave 7's first chord |
| *Workflows* | 0:38.63 | Bar 23's downbeat |
| The repository | 0:54.26 | Bar 32's downbeat |
| The end card | 1:03.55 | Bar 37's downbeat, cut to bar 199 |

As in the Intake film, a cut is centred on its hit (a crossfade starts 0.1 s
before it, a push 0.05 s before), and the cursor arrives 0.13 s early so the
click lands on the beat.

## Choices worth knowing

- **What is shown is what the app does.** Every product shot is the current
  frontend. The two Assistant conversations are loaded from history, so the
  film shows real rendering of a scripted answer, not a live model run. The
  answer's legal content was written for the demo: it cites only California
  Civil Code section 1668, and the case law search shows its count, not case
  names.
- **Adding Linear** cuts from the **Add** click to Linear under Installed,
  leaving out the sign-in window the real flow opens.
- **The workflows** are the eight in `open-legal-products/mikegc-workflows`,
  read from a checkout of it. All eight are defaults that MikeGC installs for
  every member, so its Add-ons catalog is empty and the film shows the **All**
  tab. Contract Markup's instructions open in the editor's raw Markdown view,
  as they do in the app today, because the catalog's hard-wrapped Markdown
  does not round-trip through the rich editor.
- **The document view** opens from the second tracked change, at section 11,
  where both liability changes are. The first change's new text, "twelve (12)
  months", also appears earlier in the MSA, in section 3.2, and opening from it
  goes there.
- **Tom's inbox and the repository** are neutral stand-ins, not Gmail's or
  GitHub's own interface. The email is the one the approval card shows.

## Rebuilding

Requires Node 22, Python 3 with `numpy` and `soundfile`, ffmpeg, and
Playwright's Chromium.

1. **The workflows.** Clone the catalog the shots read:
   `git clone https://github.com/open-legal-products/mikegc-workflows capture/mikegc-workflows`,
   or point `MIKEGC_WORKFLOWS` at an existing checkout.
2. **The contract.** `python3 capture/make_docx.py capture/docx/Harbor_Pine_MSA.docx msa-original`
   and `python3 capture/make_docx.py capture/docx/Harbor_Pine_MSA_markup.docx msa`
   write Harbor & Pine's draft and the redlined copy, with the Intake film's
   generator.
3. **Product shots.** Start the frontend (`npm run dev --prefix frontend -- -p 3100`;
   no backend is needed), then run `node capture/capture.cjs`. It signs in a
   fictional member, answers every `/api` call from `capture/mock.cjs`, and
   writes `capture/shots/*.png` (1600 × 1000 at 2×) with `shots.json`.
4. **Assets.** `film/fetch-assets.sh` copies the fonts, the MikeGC mark and the
   connector logos from this repository, downloads Google's vector logos from
   Wikimedia Commons, takes General Legal's logo and the avatars from the
   Intake film, and copies the shots.
5. **Music.** Run the Intake film's `audio/fetch-music.sh` once.
6. **Build.** `film/build.sh ../intake-launch-film/audio <out>` writes the cues,
   builds the soundtrack (two-pass loudness to -16 LUFS, -1.5 dBTP), renders
   the film and writes `MikeGC_Connectors_Workflows_16x9.mp4`.
   `node film/render.cjs stills 16x9 3,24,45` renders single frames for review.

## Demo data

The workspace is the Intake film's Alia, Inc., a fictional AI startup, with
Priya Shah signed in and everyone at `firstname@alia.ai`. The counterparty,
Harbor & Pine Data Services, and its people are fictional too.

The contract is a full-length draft written for the demo, in
`capture/contracts.py`: Harbor & Pine's nine-page Master Services Agreement
for renewing its data-labelling work, with three schedules, under California
law. Contract Markup's copy carries four tracked changes in Priya's name (the
app signs an Assistant edit with the person who asked for it): a cap of 12
months' fees instead of three, confidentiality, data protection and the IP
indemnity outside the cap, 30 days' notice of non-renewal instead of 90, and
renewal price rises capped at 5%. The figures agree throughout: $18,000 a
month, so three months' fees are $54,000 and the three-year term $648,000.

Priya's photo is the Intake film's AI-generated face from the SFHQ dataset
(CC0); no real person appears.

## Credits

- **Music:** Beethoven, Piano Sonata No. 14, III. Presto agitato, performed by
  Paul Pitman, courtesy of Musopen. Public domain. See the Intake film's
  credits for the source.
- **Fonts:** Inter and EB Garamond, SIL Open Font License (`frontend/src/app/fonts/`).
- **Workflows:** the instructions and metadata shown are from
  `open-legal-products/mikegc-workflows`: MikeGC's three contract workflows
  under Apache-2.0, and the others, from Open Legal Products' `mike-workflows`,
  under MIT (Proofread by Anna Guo).
- **Logos:** Google Drive, Gmail and Google Calendar (Google's vector logos
  from Wikimedia Commons), CourtListener (Free Law Project), Slack, Notion,
  Linear, Airtable and Lawve (as the connectors page draws them) are their
  owners' trademarks, shown unmodified as services MikeGC connects to. The
  General Legal logo is used with the sponsor's approval (pending).
