# Intake

Intake is the Legal team's internal tracker for contract reviews and legal
questions from the business. MikeGC is used only by the Legal team, so every
member of an organization is on the Legal team and works one shared queue.
Business colleagues never use MikeGC: a lawyer creates the request that arrived
by email, chat, phone or in a meeting, and the business person appears only as
the named requester on that record. An organization can also have MikeGC record
requests itself from its intake mailbox (Outlook or Gmail) and from Slack and
Teams messages that mention @MikeGC, and hold a conversation with the requester
in that thread: asking for missing details, posting a lawyer's questions and
replying with the resolution; see [Automated intake](intake-automation.md).

Intake is always on in every organization and in Personal; there is no
setting to switch it off. In Personal it tracks the person's own requests,
which nobody else can see.

## The requests list's URL

`/intake/requests` keeps what it shows in its query, so a link, a reload or
Back from a request opens the same list. Defaults are left out, so the plain
list is `/intake/requests`; `/intake` redirects there with its query.

| Parameter | Values |
| --- | --- |
| `tab` | `resolved` or `cancelled` (**Outstanding** when absent) |
| `scope` | `open`, `unassigned`, `overdue`, `recorded_30d` or `resolved_30d`: what a dashboard count opened |
| `status` | `submitted`, `in_review` or `needs_information` |
| `assignee` | a member's user ID |
| `requester` | one requester's name, matched without case |
| `reply` | `new`: only requests with a requester's reply nobody has opened yet |
| `sort` | `updated_asc` or `target` (most recently updated first when absent) |
| `q` | the search text |

For example, the **Overdue** count opens
`/intake/requests?scope=overdue&sort=target`. Changing tab adds a step that
Back returns from; filters, sorting and search replace the current URL. Values the page does not recognise are ignored.
`frontend/src/app/components/intake/intakeQuery.ts` reads and writes them.

## Personal intake

Every account has a personal organization behind the scenes, with the account
as its only member (see `backend/src/lib/personalOrgs.ts`). Personal intake
keeps its requests there, so it works exactly like an organization's queue
with one member. Clients never learn that organization's id: intake paths and
uploads name it `personal` (`/intake/personal/requests`, an upload destination
of `{ scope: "intake", org_id: "personal" }`), and the backend resolves it to
the caller's own personal organization, creating it for an account that
predates it. Attachments are filed under it, so only their uploader can open
them. The dashboard leaves out the unassigned count and the workload table,
since everything belongs to the owner. Deleting the account deletes its
personal organization and every request in it.

## Dashboard

Intake has two pages, `/intake/requests` (the list; plain `/intake` opens it)
and `/intake/dashboard`, and the **Requests** and **Dashboard** buttons in
their header switch between them. For owners and admins the header also has
a settings icon, which opens [automated intake](intake-automation.md) in the
workspace's settings. The
dashboard shows where the workspace's requests stand and loads afresh each
time it is opened:

- Counts of open, unassigned and overdue requests; requests created and
  requests resolved, each over the last 7, 30 (the default) or 90 days or 12
  months; and the median time from creation to resolution over the last 30
  (the default) or 90 days or 12 months. Each of these three figures has its own
  period menu in its caption. **Open**, **Unassigned** and **Overdue**
  link to the requests they count: **Open** to the plain **Outstanding** tab,
  the other two to **Outstanding** with a filter named like the count, removed
  by choosing it or another tab, and overdue requests sorted by target date.
  The other counts are read-only.
- Open requests by status, as a pie in the queue's status colors beside a
  legend with each count and share. A status with open requests links, with a
  chevron, to the **Outstanding** list filtered to it
  (`/intake/requests?status=in_review`).
- Requests created and resolved in each of the last 4, 8 (the default), 12
  or 26 weeks, chosen from the menu under the chart's title. Weeks start
  on Monday in the viewer's timezone; each week's counts are in its tooltip
  and its accessible name.
- Workload: each assigned member's open, waiting and overdue requests, busiest
  first. Each row links to that member's outstanding requests
  (`/intake/requests?assignee=<user ID>`).

`intake_dashboard` computes all of it in one call, and any member may read it.
The list's `scope` filter (`intake_list_in_scope`: `open`, `unassigned`,
`overdue`, `recorded_30d`, `resolved_30d`) uses the same definitions, so a
count and its list always agree.
A request is overdue once its target date has passed in the viewer's
timezone, as in the queue and its Overdue filter. A request reopened and
resolved again counts as resolved again in its week; its time to resolve runs
to its latest resolution. Chart colors are
the `--chart-*` tokens in `frontend/src/app/globals.css`, each theme's step
validated against that theme's card surface.

## Working with a request

1. A member opens **Intake** and selects **New request**, which opens a page
   laid out like a request: the subject as its title, the request text and
   documents on the left, and the details on the right. They enter the
   subject, the requester's name (with an optional email) and what the
   requester needs. A target date is optional and is a
   calendar date with no timezone: it is overdue once it has passed where the
   viewer is. It is a planning aid, not a verified legal deadline.
   The requester's team is not asked for yet; requests keep any team recorded
   earlier, and search still matches it.
   The **Reviewer** menu lists **Unassigned** and every member with
   their avatar, the creator first as **Myself**; it starts on the
   creator. The request page's assignee menu offers the same list.
2. The queue's **Outstanding** tab, which it opens on, lists the
   organization's open requests (New, In progress and Waiting on requester);
   the **Resolved** and **Cancelled** tabs list the closed ones. Search covers
   the subject, description and requester. Filters narrow by status and by
   reviewer, and the list can be sorted by target date. Open requests
   past their target date are marked overdue.
3. Any member can assign or reassign a request, add notes at any time, mark
   it **Waiting on requester** and resume it, edit its details while it is
   open, resolve it with an optional resolution, cancel it with a required
   reason, reopen it, and delete it. A resolution or cancellation reason
   reads in the timeline beside the change.
4. On a request MikeGC recorded from a thread, a member can also message the
   requester there (**Message requester** in the note box, which marks the
   request **Waiting on requester**), send the resolution and chosen
   documents with **Resolve request**, and stop MikeGC asking for missing
   details. The requester's replies appear in the timeline under their name,
   and the queue marks a request with an unopened reply **New reply**. The
   [requester loop](intake-automation.md#the-requester-loop) describes what is
   sent and when.

The request page centres the request beside a **Details** sidebar. The page
header shows the subject in its breadcrumb, with a **Copy link** button
and a **More actions** menu holding **Delete request**. Above the request, the subject
is the page title in a serif heading, edited in place where the request can be
edited. On wide screens the
sidebar stays in place while the page scrolls; on narrow
screens it comes first. It shows the status, the reviewer,
the requester's name and email, the target date, who created the request
(**Created by**) and when (**Created**).

The status is a menu in the sidebar. While a request is open it lists every
status: **In progress** and **Waiting on requester** apply at once, **Resolved**
brings **Add comment** into view for the resolution, **Cancelled** opens a dialog for the
required reason, and
**New** cannot be chosen. A resolved or cancelled request's status menu offers
**Reopen** instead.

Details are edited in place; there is no edit dialog. While a request is open,
each sidebar field saves when it is left or Enter is pressed (Escape puts the
saved value back), the reviewer saves as soon as it is chosen
from its menu, the title saves the same way as a field, and the description
has a pen button that opens it with **Submit** and **Cancel**. Every edit sends the request's whole
details at its loaded version, so an edit made while another change is saving
waits for the refreshed request before it is sent. A resolved or cancelled
request shows its details as text.

A **Request** panel holds the description and the documents, and an
**Activity** panel holds the timeline. Notes and every change appear together
in one **Activity** timeline, oldest first, and the **Add comment** box is
always open at its end; a resolved or cancelled request has **Reopen** there
instead. **Resolve request** beside **Submit** resolves the request with the
comment as its
resolution, if one was typed; it can also resolve with the box empty. The resolution then reads under the "resolved
this" entry rather than as a separate one. Each entry puts the avatar of the person who made it on the
timeline's line and reads as one small line of who did what and when, such as
"Sam Colleague marked this waiting on the requester · 30 Oct 2026, 19:05". A
note, resolution or cancellation reason shows its text below that line, and a
note's documents are tagged under its text. An
automatic change, such as unassigning someone who left, gets a neutral mark
and reads "Automatically unassigned …".

Any member can delete a request, in any state, after confirming it. Its notes,
history and attached documents are deleted with it, and the documents' files
are queued for storage cleanup. The organization keeps a content-free
`request_deleted` event recording who deleted a request and when. A retried
delete returns its original receipt, and the command IDs that touched the
request become tombstones, so a lost retry of the command that recorded it
cannot bring it back. In the queue, a row's menu and the **Actions** menu for
selected rows offer **Cancel request** for open requests and **Delete
request** for any request. Deleting or cancelling several does each in turn,
reports how many changed in the meantime, and leaves those still selected.

Statuses are **New**, **In progress**, **Waiting on requester**, **Resolved**
and **Cancelled** (stored as `submitted`, `in_review`, `needs_information`,
`resolved` and `cancelled`). While MikeGC itself waits on the requester's
answer, the queue reads "Waiting on requester (MikeGC asked)". Assigning a new request moves it to In progress;
unassigning moves it back to New. Resuming or reopening returns a request to
In progress when it has an assignee and to New otherwise. History records who
made each change and, for assignments, to whom.

## Documents

Every request can carry documents. The New request page shows a drop zone:
drag files onto it, or click it to open the app's **Add documents** modal and
pick files from the library or upload new ones. PDF, Word, Excel and
PowerPoint files are accepted. The files upload, and library files are
copied, after the request is saved, and the page stays locked until they
are, so the request cannot be sent twice. If an upload fails, the request is
still saved and a notice names the documents to add again from the request.
On the request page, **Documents** lists the files in rows like the file
directory's (name, who added it, when and size); a ready file opens in the
document viewer. Below the list, a grey field like the playbook run's opens
**Add documents**, and files dropped anywhere on the page are added to the
request. The note field's **Add documents** opens the same modal, and files
picked there or dropped on the field wait with the note's draft. They upload once the note is saved, are tagged on the note
(opening in the viewer once ready) and are listed with the request's other
documents. If an upload fails, the note is still saved and a notice says to
add the documents to the request instead.

Attachments are documents of library kind `intake_attachment`, owned by the
request's organization and linked to the request in `intake_request_documents`.
The upload worker links each document to its request as soon as the document
row exists, before any bytes are copied, so a closed tab never leaves a file
that belongs to no request. If the request is gone by then, the document is
removed and the upload stops. Documents added with a note, or with a
resolution written in the note form, name that message in the upload, and the
link records it in `message_id`. The message must be the uploader's own note or
resolution on the same request. It stands for those documents in the timeline,
so they get no separate `document_added` event.

A library file picked in **Add documents** is copied, never moved:
`POST /intake/:org/requests/:id/documents/copy` takes up to 20 document IDs
and an optional note or resolution ID; the app sends a longer choice 20 at a
time. Each source must be readable by the
member, come from the request's workspace, as a project's documents must,
and have finished processing. The copy becomes its own `intake_attachment`,
linked before its bytes are copied and processing until its version exists,
so the library original and the request's copy change independently.
Uploading in the modal files the new document in the member's library first,
then copies it to the request.

- Attachments never appear in the Library or in Library search.
- Every current member of the organization can open, preview, download and use
  them in Mike's viewer and review tools; outsiders cannot.
  `org_private_document_access` grants this, so the API's document checks and
  document text search agree.
- A departing member's uploads stay with their request: they are neither
  handed to a successor nor archived as the member's private work, and they
  are kept (with the uploader detached) when the member's account is deleted.
- Deleting a request, deleting all intake requests in Privacy & Data, or
  purging the organization deletes its attachments, and the document version
  trigger queues their storage objects for durable cleanup.

Apart from the triage, clarifying questions and preprocessing that
[automated intake](intake-automation.md) runs on the messages it receives,
intake does not include scheduled processing or automatic legal decisions.
Members hear about their requests through the web app's
[notifications](#notifications) only; nothing is emailed or posted.

## Notifications

The member a request is assigned to gets a toast in the web app when it needs
their attention:

- **New Intake Request** when a request becomes theirs: it is created and
  assigned to them by a colleague, assigned or reassigned to them, or recorded
  and assigned by MikeGC (including when MikeGC assigns it by a rule once the
  requester has answered its questions). For example: "**Supplier NDA**: Sam
  Colleague assigned it to you".
- **Intake request update** when someone else changes a request assigned to
  them: the requester replies, a colleague comments, waits on the requester,
  resumes, resolves, cancels or reopens it, edits its details or adds a
  document, MikeGC asks the requester for details or finishes preprocessing,
  or a colleague stops MikeGC asking.

Nobody is notified of their own changes, and an unassigned request notifies
nobody. Each toast names the request and what happened, and has **Open**,
which opens the request and switches to its workspace. A request in a
workspace other than the open one names it in the title: "Intake request
update (in Contoso Legal)". Several changes to one request since
the last check make one toast ("Sam Colleague resolved it · 2 more updates"). If
more than three requests have news at once, the two newest get their own
toast and one more sums up the rest, with **View requests** when they are all
in the open workspace. An open request page refreshes when a notification
names it, and so does the requests list, unless it has more than one page
loaded: like returning to the window, it then keeps the rows already on
screen.

While a tab is visible it checks every 30 seconds, and again as soon as the
tab is shown or focused. Each notification is shown once, by whichever of the
member's tabs collects it first, so a lawyer who opens the app in the morning
sees what was assigned or changed overnight. Notifications are kept for a day:
one nobody collected by then is never shown. A notification for a request that
is no longer assigned to the member, or in a workspace they have left, is
dropped. A failed check says nothing and tries again later, less often, up to
every 5 minutes. A check that gets no answer within 30 seconds stops holding up
the next one, and a notification collected while the tab is hidden waits until
it is shown, so it isn't timed out unseen.

`intake_notifications` holds only references: the recipient, the request, and
the history entry or message that caused it. Triggers on `intake_events` and
`intake_messages` write it in the same transaction as the change, so a retried
command (which replays its receipt) notifies nobody twice.
`POST /intake/notifications/claim` (`intake_claim_notifications`) hands the
signed-in member theirs from every workspace and deletes them, reading names
and the subject at that moment; it names a personal workspace `personal`. A
notification is deleted with its request, the history entry or message, the
organization's intake data or the recipient's account, and when the recipient
leaves the organization; the stale-work sweep deletes uncollected ones after a
day. The claim is rate limited per signed-in member
(`RATE_LIMIT_INTAKE_NOTIFICATIONS_MAX` per
`RATE_LIMIT_INTAKE_NOTIFICATIONS_WINDOW_MINUTES`, 240 per 15 minutes by
default) instead of from the shared per-address budget, so an office behind
one address doesn't use that budget up. Claims it turns away (no session or a
bad one) are counted per address before the session is checked
(`RATE_LIMIT_INTAKE_NOTIFICATIONS_FAILED_MAX`, 60 per window), and other
methods on the path stay under the shared budget.

## Access and retention

- Every current member of a team organization can read and work every
  request, regardless of role. Personal requests are their owner's alone. There is no separate Legal roster. This shared
  queue is unsuitable for matters that need separate access restrictions
  between members.
- Requester names, emails and teams are business records typed by Legal, not
  MikeGC accounts. They are deleted with the requests.
- A member who leaves the organization loses access, and their open requests
  are unassigned automatically (In progress becomes New). Resolved and
  cancelled requests keep their historical assignee.
- Requests belong to the organization and remain when a member leaves.
  Account deletion clears the person's identity references (as creator,
  assignee, note author and history actor) and their command receipts in the
  same transaction that deletes the Auth identity. A storage cleanup failure
  leaves that attribution intact so the deletion worker can retry; names or
  other information typed into request text are not rewritten.
- Organization deletion uses the existing 30-day recovery period. Requests are
  unavailable while the organization is deleted, return on restoration, and
  cascade on permanent purge. An owner can also delete all request data in
  **Privacy & Data**. Only organization, actor
  and retired command IDs remain to stop an old retry from recreating deleted
  content. These identifiers contain no request text and are removed when the
  account identity or organization is deleted.

Account exports do not include intake requests: they are organization records,
not the exporting person's data. Exports built while account exports still
included intake carry a manifest of the exact request IDs, immutable creation
identities and identity-erasure revisions they serialized. Downloading one
checks these and current access before and after reading storage, so
membership loss, request purge, organization deletion or erasure of a
contributor still invalidates it.

## Reliability

The API derives the actor from authentication. Service-only SQL functions check
current membership, organization state and request version under database
locks. Browser database roles cannot query intake tables or execute its RPCs.

Each write carries a command UUID. Retrying the same command and payload
returns its saved receipt without creating another request, note or event.
Reusing a command with changed input is rejected as `intake_command_reused`,
distinct from a concurrent change (`intake_conflict`). State, history and receipt commit together.
Notes leave the request itself unchanged, so they carry no version and never
conflict. Conflicts refresh the current request while retaining unsent text. An
uncertain network result locks editing and offers **Check again** for the same
command. A later access denial hides request content immediately.

The queue pages by keyset cursor, so a request created or updated while
someone scrolls is never shown twice. Returning to the window refreshes the
queue and the open request in place, at most every 30 seconds, without dropping
rows already loaded or discarding drafts; a refresh that fails says so and
leaves the rows on screen.

Drafts and unconfirmed commands stay in tab memory, scoped to the signed-in
account, organization and request. Back/Forward, internal navigation and
workspace changes preserve them. Returning rechecks access and current server
state. An in-flight result is handled by its original view when you return,
rather than navigating an unrelated page. Signing out or changing accounts
clears drafts and pending operations. Closing the form explicitly discards its
draft; reloading or closing the tab loses it. No legal text or commands are
written to browser storage or history state. Do not treat unsent text as a
saved request or note.

## Deployment and rollback

Apply migrations before starting the new application build:

- `20261026_00_org_departure_auth_role.sql` fixes the existing membership-departure
  trigger's Auth-table read under the trusted trigger owner. It leaves actor
  authorization unchanged and does not grant general access to `auth.users`.
- `20261026_01_intake_requests.sql` adds the intake schema, commands and lifecycle.
- `20261029_01_intake_on_by_default.sql` turns intake on by default; the
  tracker migration below then removes the setting altogether.
- `20261030_01_private_access_cleanup_auth_role.sql` lets Auth delete accounts
  that own projects, chats or other work by running the private-content cleanup
  trigger under its trusted owner.
- `20261030_02_intake_internal_tracker.sql` makes intake the internal tracker:
  it adds requester and creator columns and backfills existing requests from
  their creator's profile, widens message kinds for notes, resolutions and
  cancel reasons, drops the Legal roster and its trigger, removes the on/off
  setting and its configuration functions, replaces the request
  commands, adds keyset list indexes, and unassigns open work when a member
  leaves the organization (a trigger that runs as its trusted owner so GoTrue
  account deletion can cascade through it).
- `20261030_03_intake_attachments.sql` adds the `intake_attachment` document
  kind, the `intake_request_documents` link table with its attach and list
  functions, the trigger that deletes a document when its link goes, member
  read access through `org_private_document_access`, and the exclusions that
  keep attachments out of departure handover and private-content listings.
- `20261030_04_intake_delete_request.sql` adds `intake_delete_request` and the
  `delete` capability on the request view and queue rows.
- `20261030_05_intake_sort_updated_asc.sql` lets the queue list the least
  recently updated requests first.
- `20261031_01_intake_remove_category.sql` drops the request type (contract
  review or legal question) and redefines the functions that used it.
- `20261101_01_intake_note_documents.sql` links documents to the note they were
  added with (`intake_request_documents.message_id`) and lists that link.
- `20261101_02_intake_personal_workspace.sql` lets each account's personal
  organization hold intake requests.
- `20261101_03_intake_dashboard.sql` adds `intake_dashboard`.
- `20261101_04_intake_list_scopes.sql` adds the list's `scope` filter, so each
  dashboard count opens its requests.
- `20261101_05_intake_requester_filter.sql` adds the list's `requester`
  filter and `intake_list_requesters`, which lists each requester once for
  the Requester filter.
- `20261101_06_intake_member_photos.sql` returns profile photos with the
  member list and the dashboard's workload rows, and names who acted on each
  history entry by ID, so intake avatars show photos without repeating them.
- `20261101_07_intake_resolution_documents.sql` lets documents added with a
  resolution link to it, as they do to a note.
- `20261101_08_intake_dashboard_periods.sql` lets the dashboard read its
  created, resolved and median figures over chosen periods, and says which
  periods it used.
- `20261102_01_intake_resolve_optional_text.sql` lets a request be resolved
  without a resolution; cancelling still needs a reason.
- `20261102_02_intake_automation.sql` adds automated intake: the
  per-organization settings (`intake_automation`), what each member handles
  (`intake_member_focus`), the messages received (`intake_inbound`), a request's
  `source`, the `automated` mark on events and attachments, and
  `intake_submit_automated` and `intake_attach_automated`, which record a
  request and its documents as MikeGC.
- `20261103_05_intake_requester_loop.sql`, `20261103_06_intake_mailbox.sql`
  and `20261103_07_intake_teams.sql` add the requester loop, the Outlook and
  Gmail intake mailbox and Teams. See
  [Automated intake](intake-automation.md#deployment) for what each changes.
- `20261104_08_intake_notifications.sql` adds [notifications](#notifications):
  the `intake_notifications` table, the triggers on `intake_events`,
  `intake_messages` and `org_members` that write and clear it, and
  `intake_claim_notifications` and `intake_expire_notifications`.
- `20261111_01_intake_agent.sql` adds what the
  [intake agent](intake-automation.md#the-intake-agent) needs: the details a
  member has edited (`member_edited_fields`, which MikeGC never changes),
  `intake_update_automated`, and MikeGC's own answers in a thread with no
  request (`intake_conversations.replies`).

Use the existing migration runner documented in [deployment.md](deployment.md).
Do not replay historical migrations over a fresh schema. Fresh installations use
`backend/schema.sql`, including these migrations in its ledger.

Test with a synthetic organization first. There is no new worker kind or
scheduler: attachments use the existing upload worker, and account deletion and
storage cleanup use the existing durable workers.

The tracker migration replaces the SQL functions the previous build called, so an older binary cannot work
requests once it has run; roll application code forward rather than back.
Keep the schema and stored records; do not drop the tables as rollback.

## Verification

- `npm test --prefix backend` and backend build, contract and test typechecks.
- `npm test --prefix frontend`, frontend typecheck/lint/production build, and
  Word add-in typecheck for shared-contract compatibility.
- `npm run test:stack --prefix backend` on a disposable local Supabase stack.
  The intake suite uses real authentication, routes, SQL and the account
  deletion and export workers, including Auth deletion of an assigned member
  while the organization is suspended, an older export manifest that is
  revoked with membership, and attachments that every member can list and
  read and that go with their request.
- `MIKE_TEST_POSTGRES_CONTAINER=<isolated-container> npm test --prefix backend --
  src/modules/intake/__tests__/intake.postgres.test.ts` for every command,
  transaction rollback, concurrent commands, departure, keyset paging, legacy
  backfill, erasure and purge, plus attaching, listing, member access,
  departure handover, purge with storage cleanup and organization purge for
  attachments. Schema-drift CI explicitly runs these tests and
  the existing organization lifecycle suites.
- `npm run test:e2e -- e2e/intake.spec.ts --project=chromium` against the documented
  local stack. The browser journey attaches a contract while creating the
  request, keeps it across Back/Forward, and has a second lawyer open it once
  the upload is processed. It restores drafts across Back/Forward, drops a
  submission response after commit, then injects a rate limit and checks the
  exact retry creates only one request. It assigns, waits, resumes and drops a
  resolution response after the real commit, checking that the retry resolves
  exactly once, then reopens and cancels with a reason. It also checks narrow
  layout, dark mode and critical accessibility.
