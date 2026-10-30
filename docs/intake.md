# Intake

Intake is the Legal team's internal tracker for contract reviews and legal
questions from the business. MikeGC is used only by the Legal team, so every
member of an organization is on the Legal team and works one shared queue.
Business colleagues never use MikeGC: a lawyer records the request that arrived
by email, chat, phone or in a meeting, and the business person appears only as
the named requester on that record.

Intake is always on in every organization; there is no setting to switch it
off. Personal workspaces do not have an intake queue.

## Working with a request

1. A member opens **Intake** and selects **New request**. They choose the type
   and enter the subject, the requester's name (with an optional email and
   team) and what the requester needs. A target date is optional and must
   include a timezone; it is a planning aid, not a verified legal deadline.
   **Assign to me** is checked by default.
2. The queue lists every request in the organization. Search covers the
   subject, description and requester. Filters narrow by status and by
   assigned lawyer, including **Unassigned** and **Assigned to me**, and the
   list can be sorted by target date. Open requests past their target date
   are marked overdue.
3. Any member can assign or reassign a request, add notes at any time, mark
   it **Waiting on requester** and resume it, edit its details while it is
   open, resolve it with a required resolution, cancel it with a required
   reason, and reopen it. The resolution or cancellation reason is pinned to
   the request.

The request page is one centred column. The page header shows the subject
once, with one primary action (**Resolve** while the request is open,
**Reopen** once it is closed) and a **More actions** menu for marking waiting,
resuming, editing details, copying a link and cancelling. Below it sit the
requester and the request's facts, the status, and an assignee menu that saves
as soon as a person is chosen (with **Assign to me** first). Notes and every change appear together in one
**Activity** timeline, oldest first, with the note box at its end.

Statuses are **New**, **In progress**, **Waiting on requester**, **Resolved**
and **Cancelled** (stored as `submitted`, `in_review`, `needs_information`,
`resolved` and `cancelled`). Assigning a new request moves it to In progress;
unassigning moves it back to New. Resuming or reopening returns a request to
In progress when it has an assignee and to New otherwise. History records who
made each change and, for assignments, to whom.

## Documents

Every request can carry documents, whether it is a **Contract review**
(stored as category `nda`) or a **Legal question** (`general`). The New request
form shows a drop zone: drag files onto it or click it to browse. PDF, Word, Excel and PowerPoint files are accepted. The
files upload after the request is saved. If an upload fails, the request is
still saved and a notice says which documents to add again from the request.
On the request page, **Documents** is a row of file chips that open in the
document viewer, with **Add** to browse for more. Files dropped anywhere on the
page are added to the request.

Attachments are documents of library kind `intake_attachment`, owned by the
request's organization and linked to the request in `intake_request_documents`.
The upload worker links each document to its request as soon as the document
row exists, before any bytes are copied, so a closed tab never leaves a file
that belongs to no request. If the request is gone by then, the document is
removed and the upload stops.

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

This slice does not include notifications, AI triage, scheduled processing or
automatic legal decisions.

## Access and retention

- Every current member of a team organization can read and work every
  request, regardless of role. There is no separate Legal roster. This shared
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

The queue pages by keyset cursor, so a request recorded or updated while
someone scrolls is never shown twice. Returning to the window refreshes the
queue and the open request in place, at most every 30 seconds, without dropping
rows already loaded or discarding drafts.

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
  local stack. The browser journey attaches a contract while recording the
  request, keeps it across Back/Forward, and has a second lawyer open it once
  the upload is processed. It restores drafts across Back/Forward, drops a
  submission response after commit, then injects a rate limit and checks the
  exact retry creates only one request. It assigns, waits, resumes and drops a
  resolution response after the real commit, checking that the retry resolves
  exactly once, then reopens and cancels with a reason. It also checks narrow
  layout, dark mode and critical accessibility.
