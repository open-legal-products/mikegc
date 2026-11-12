# Automated intake

MikeGC can record intake requests itself, so a lawyer doesn't have to retype
what arrived, and holds a conversation with the requester in the thread the
request came from (see [The requester loop](#the-requester-loop)). It reads
three kinds of channel:

- **Email (Outlook or Gmail).** Company users email a designated intake
  address, such as `intake@example.com`. MikeGC connects to that mailbox
  itself, through Microsoft Graph for Microsoft 365 or the Gmail API for
  Google Workspace, reads new mail from it and replies as it, so replies
  thread natively and land in the mailbox's Sent folder.
- **Slack.** Anyone in the organization's Slack workspace mentions `@MikeGC`
  in a channel MikeGC has been added to. A top-level message becomes the
  request, and its author is the requester. A mention in a thread sends the
  whole thread, up to the mention, and the thread's first author is the
  requester.
- **Microsoft Teams.** Anyone mentions `@MikeGC` in a channel of a team the
  organization's own MikeGC bot has been added to, the same way as in Slack.

MikeGC answers in the thread, thanking the requester and saying who will
pick the request up ("Thanks, I've passed this to Legal. Sam Lawyer will
pick it up."). It doesn't link to the request: its page is only for the
organization's members, and the requester follows the request in the thread.

A message that clearly isn't a request, such as "hi", "how are you" or a
question about what MikeGC is, gets a short, friendly answer in the same
thread instead, in Slack, Teams and email alike, and no request is recorded.
The [intake agent](#the-intake-agent) decides this; any legal question,
document, deadline or matter is a request, and when unsure it records one. The
answer never gives legal advice. The next message in that thread reaches
MikeGC without a mention and is read with MikeGC's earlier answers. After
three answers in one thread, the next message there is recorded as a request.
Mail in another request's email thread has no thread MikeGC can answer in, so
it is always recorded.

Every other message becomes a **New** or **In progress** request in the
organization's queue, created by **MikeGC**: MikeGC is not an account, so the
request, its "created" entry and the documents it attached all read as
MikeGC's. The request page notes where it came from ("Created by MikeGC from
Slack").

An organization's owners and admins set this up in the **Intake** section of
the organization's settings (`/organizations/<id>/settings/intake`, also
reached from the settings icon in Intake's header), with the **Channels** and
**Triage rules** one after another. The models triage and preprocessing run
with are chosen in the organization's **Model Preferences** tab
(`/organizations/<id>/settings/models`), also for owners and admins. The
channels are Outlook, Gmail, Slack and Teams, each a tile like a connector's
with its logo and name. Outlook and Gmail are two ways to connect the one
intake mailbox, so connecting either replaces the other. A channel that isn't
set up shows **Set up**; one that is shows its on/off switch, which saves at
once, and the tile opens its dialog. The dialog has everything for that
channel: its IDs and secrets (write-only, never shown again), the URL to give
Slack, Teams or Microsoft, notices about missing permissions, the email sender
name and domains, and, once those details are saved, its switch. Connecting a
mailbox, or the save that completes Slack's or Teams's setup, turns the
channel on. **Help**, at the start of the dialog's
footer, opens a help screen with what the channel does, its setup steps and
what each setting means; **Back** returns to the fields as they were.
Everything in the dialog, its switch included, is saved with its **Save**
button (a mailbox is connected with **Connect**); Cancel, Close or Escape
discards what wasn't saved.
A channel turned on starts once it is set up: email once its mailbox is
connected, Slack once both its secrets are saved, Teams once its app ID,
tenant ID and secret are saved and Microsoft accepts them. Who each request goes to, and
whether MikeGC preprocesses it, is set on the rules page beside it
(`…/settings/intake/rules`). Other members aren't offered either page, and one
who follows a link to it is told it is for owners and admins; the API refuses
them too. In Personal, the account's owner finds both in their own
**Settings → Intake** (`/settings/intake`), and its models in their own
**Settings → Model Preferences**. The old `/intake/settings` and
`/intake/rules` links open the active workspace's pages.

## The intake agent

The intake agent is how MikeGC handles a message in Slack, Teams, Gmail or
Outlook. There is no switch for it, and it runs for all four channels: it
runs with the **Triage** model chosen under **Intake** in Model Preferences,
and doesn't run without one. For each message it reads the whole
conversation (the thread so far and MikeGC's own earlier answers there, or,
in a request's thread, the request and everything sent and replied since) and
acts through four tools, offered for every message. Each tool checks whether
it applies and tells the agent why when it doesn't:

- **reply** answers in the thread the message came from. With no request
  yet, it is a short answer to small talk, or up to three questions when no
  rule can be chosen yet (see [Stage 1](#stage-1-choosing-the-rule)). On a
  recorded request whose rule waits on the requester, it is MikeGC's
  questions to choose the rule, posted with MikeGC's own opening line.
  Otherwise, when the requester writes in a request's thread, it is MikeGC's
  answer: it acknowledges the message, says what it added to the request
  ("I've added the $500k contract value to your request."), or answers a
  question from the request and the thread. An answer doesn't make the
  request wait. A reply ends the agent's turn.
- **record_request** records the request: a subject and a summary, with the
  original message, its sender and time (in UTC, since members read it from
  anywhere) kept below the summary; the requester's name and email; a target
  date if the message asks for one, working out dates such as "by Friday"
  from the day it was sent, in UTC; and the attachments that matter,
  leaving out the rest, such as signature logos.
- **update_request** changes a recorded request's subject, summary or target
  date from what the requester writes later ("we now need it by the 14th").
  It never changes a detail a member has edited, the requester, the
  assignee or the state, and never touches a resolved or cancelled request.
  Each change is a MikeGC note on the request, such as "Updated the due date
  to 14 Nov 2026 from the requester's reply."
- **choose_rule** assigns the request using the organization's **rules**: the
  member of the first rule, in order, whose condition it meets, or no one
  when none does.

The agent takes at most four steps for a message; most take one or two (a
greeting is one reply, a clear request one step with two tool calls). If it
ends without answering or recording, the message is recorded as it arrived,
unassigned, so a message is never lost.

## Rules and AI preprocessing

The rules page is a table of rules, opened with **Edit** under **Triage
rules** in the Intake settings. It works like the other tables:
search and **New rule** in the header, **All**, **Preprocessed** and **Not
preprocessed** tabs in the toolbar, filters on the **Assign to** and
**Preprocessing rule** columns, and checkboxes whose
selection the toolbar's **Actions** can turn AI preprocessing on or off for,
or delete (after asking). Each row has:

- a **Condition**, in plain words, such as "The request is about an NDA or a
  procurement contract";
- the member to **Assign to**;
- **AI preprocessing**, Yes or No;
- a **Preprocessing rule**: an assistant workflow or a playbook for
  preprocessing to follow, or none.

A member can have several rules. Rules are tried from the top, so put the most
specific first: drag a rule by the handle beside its priority to move it, or
use Move up and Move down in its row's menu (`···`, or a right-click), which
also deletes it. Each rule's **Priority** is its place in the order, and
filtering keeps it. A condition too long for its column opens whole, over the
rows below, when clicked or tabbed into; Enter, Escape or leaving it closes
it. A rule saves once
it has both a condition and a member. Rules need a triage model: without one,
requests are left unassigned and nothing is preprocessed.

With AI preprocessing on, once MikeGC has recorded a request the rule assigns,
and attached its documents, it works on the request in the background, before
the reviewer picks it up. For a request from a thread, it first checks that
the workflow or playbook has what it needs and asks the requester for
anything missing (see [Stage 2](#stage-2-what-the-playbook-or-workflow-needs)).
Then:

- **With a workflow**, MikeGC follows the workflow's instructions to answer
  the request and suggest changes to its documents.
- **With a playbook**, MikeGC reviews each document against the playbook, as a
  playbook review does, and the review appears in that admin's playbook runs.
- **With neither**, MikeGC answers the request in general terms and suggests
  the changes a careful in-house lawyer would make.

MikeGC posts its answer as a note on the request, which reads as MikeGC's. It
makes its suggested changes to the request's Word documents as tracked
changes signed MikeGC, as a new version that reviewers accept or reject like
any other. It marks up only a document as it arrived: one already revised is
left alone. PDFs and other files are read but not marked up. It waits for a
document's text to be extracted, and after its last try answers without
it, naming the documents it couldn't read.

Preprocessing runs as the owner or admin who last saved the intake settings,
with their access and the organization's model keys, on a mid-tier model (for
example Claude Sonnet). A workflow or playbook newly chosen in a rule must be
one the admin saving it can open; one that later can't be opened, a missing
model key, or an admin who no longer administers the organization is
explained in the note instead. Its answer is a first draft for a lawyer, not
legal advice, and the request's text and documents are treated as untrusted
content, as in the agent.

The agent is a convenience, not a legal decision. Reviewers can reassign a
request, edit its details and add or remove documents as with any other
request.

The conversation is untrusted text. Every limit lives in the tools, not in
the prompt: a tool checks what it is given and answers the model with a short
result, such as "recorded" or "refused: the request is already recorded".
The agent can only pick one of the organization's rules, by number, and the
message's own attachments; member IDs never reach the model. Every field is
checked like one a member typed. A requester email must appear in the
message; otherwise the sender's address is used when the sender is the
requester, and none when someone else is. A reply has at most 600 characters
and no links, email addresses, mentions or formatting, and goes only to the
thread the message came from. If the details are still refused, the request
is recorded without the target date and requester email rather than not at
all. When no model is chosen, its key has gone, or the model fails, MikeGC
still records the request: the email subject or the first line of the Slack
message as the subject, the message as the description, the sender as
requester, no target date, unassigned, with every accepted attachment.

What the agent decides for a message is saved on it before any of it is
done, so a job retried after a crash does the same without asking the model
again.

The agent and AI preprocessing run with the organization's model keys, as the
owner or admin who last saved the settings, each with its own model under
**Intake** in Model Preferences. Each list offers every model those keys can run, and saving one
checks it has a key. The agent calls tools, so choose a model that does that
reliably; one that can't records each message as it arrived. New settings
start triage on a fast, low-cost model (for
example Claude Haiku) and preprocessing on a stronger one (for example Claude
Sonnet), each with a key, so both run from the start; with no key at all they
start with none. If the person they run as is no longer an owner or admin,
they use only the deployment's own keys. The Intake settings say, for each,
when there is no model to choose, none is chosen, or the chosen model's key
has gone; preprocessing that can't run says why in its note instead.

## The requester loop

MikeGC holds a two-way conversation with the requester in the Outlook,
Gmail, Teams or Slack thread a request came from. It does four things
there:

1. **Asks for missing details on its own**: first what it needs to choose a
   triage rule, then, once a rule applies, what that rule's playbook or
   workflow needs before preprocessing can run.
2. **Posts a lawyer's questions**, asked from the request page.
3. **Replies on resolution**, when the lawyer chooses to, with a reply they
   write and the documents they choose.
4. **Answers the requester's messages**: the intake agent acknowledges each
   message the requester sends, saying what it added to the request.

The requester's answers come back onto the request and move it forward.
Everything else a lawyer does (notes, assignments, edits, other status
changes, cancellations) stays inside MikeGC. Requests a member typed have
no thread, so none of this applies to them.

Questions to choose the rule come before the request is recorded (stage 1);
questions for its preprocessing come after, so a lawyer can see the request
while MikeGC waits for those answers. MikeGC asks in at most **two rounds**
in total, across both stages; a round is one message with up to three
questions, numbered when there is more than one. Asking is always on.

### Stage 1: choosing the rule

The agent compares the conversation with the rules' plain-language
conditions. When no rule clearly matches but one or more is plausible (the
conditions "supplier contracts" and "customer contracts" both fit an NDA with
Acme, so MikeGC asks "Is Acme a customer or a supplier?"), or when a
condition turns on a fact the message doesn't state, such as "contracts over
$250k", MikeGC asks **before recording anything**: the questions are its
reply in the thread, and the requester's answer (no mention needed) is read
by the agent with the whole conversation and MikeGC's questions. The request
is recorded once a rule can be chosen, so its subject, summary and due date
reflect the answers too. After three replies in one thread, the next message
is recorded whatever it says, and a request that matches no rule is left
unassigned.

A message with attachments is recorded at once, so its files are kept. Then
the request is recorded unassigned and **Waiting on requester**, and the
questions go in MikeGC's acknowledgement; the agent reads each answer over
the whole thread, updates the request's details from it, and chooses the
rule or asks once more.

### Stage 2: what the playbook or workflow needs

Once a rule with AI preprocessing applies, a readiness check runs before
preprocessing. It reads the request, its replies, its documents (the first
20,000 characters of each), the rule's condition, and the workflow's
instructions or the playbook's description, represented party, document
types, jurisdictions and rule names and conditions (required rules first,
without positions or sample clauses). It asks only what that playbook or
workflow needs: an agreement that isn't attached, a schedule it refers to,
which side we are on or which entity is signing, a deadline the workflow asks
for. If something is missing, the request (already assigned) waits on the
requester and preprocessing waits too; MikeGC's acknowledgement waits for
this check, so its questions go in the same message. When nothing is missing,
or the rounds have run out, preprocessing runs; in the second case its note
starts with "Still missing: …". A rule without preprocessing skips stage 2.
If the model can't be reached, the check counts as ready, so a request never
waits on a broken model.

### Answers

- Any person's message in the thread counts as an answer, with no mention
  needed. In email, only messages from the requester, someone already on the
  thread, or a colleague at the requester's domain count, and only when the
  sender's mail system authenticated them (see [Receiving](#how-it-works)).
- An answer is recorded on the request as a reply, named for its author and
  channel, and its files become the request's documents, tagged on the reply.
- An answer to MikeGC's question runs the stage that asked again: the agent
  for the rule, the readiness check for preprocessing. When nothing is
  missing, the request returns to the state it would have had (**New** if
  unassigned, **In progress** if assigned).
- An answer to a lawyer's question moves the request from **Waiting on
  requester** back to work.
- Any reply on an open request, except an answer to the readiness check, is
  read by the agent, which may update the request's subject, summary or
  target date from it (never one a member has edited). It doesn't answer in
  the thread once the rule is decided.
- A message on a resolved or cancelled request is recorded and flagged, and
  the request doesn't reopen.
- Every reply raises a plain-text **New reply** marker in the queue until
  someone opens the request; the **Has new reply** filter lists them.

### A lawyer's questions

The note box on a request with a thread has two modes: **Internal note** (the
default) and **Message requester**. In the second, **Ask requester** posts
the text in the thread and marks the request **Waiting on requester**; a
follow-up can be asked while it waits. In Slack it is posted under the
lawyer's name, "Emma Chen (Legal)", which Slack still shows with its APP badge
(without the app's `chat:write.customize` scope it reads "Emma Chen (Legal)
asks: …"). Teams can't change the sender of one message, so there it reads
"Emma Chen (Legal) asks: …". In Gmail it comes from "Emma Chen via Legal" at
the intake address; Outlook sets the same name and also starts the message
with it, in case Exchange keeps the mailbox's own. "Legal" is the
organization's sender name, set in the Outlook or Gmail dialog.

### Resolution reply

**Resolve request** on a request with a thread opens a dialog that first asks
only whether to reply: **Send reply in Slack** (in Teams, or by email), off
by default. The comment being written stays the internal resolution and is
never sent. Switched on, the dialog shows a **Message** box, filled from the
comment to start with but written apart from it, and a checklist of the
request's documents. Documents whose current version is newer than the one
that arrived, such as MikeGC's redline after a lawyer accepted its changes,
are ticked by default. Sending posts the message, stored as the request's
`answer` message, and the current version of each ticked document in the
thread. With no message and no documents, nothing is sent. By email, documents are attached in the order they were
ticked until the next would pass the size limit (25 MB after encoding for
Gmail, the mailbox's send limit for Outlook, 35 MB by default); the rest are
named in the email ("… was too large to email, so ask Legal for a copy.") and
on the request.

On the request, the resolution reads under its change in **Activity** in two
parts: the **Internal comment**, which stayed in the app, and the **Reply to
the requester**, if one was sent: its text, or "Documents only.", with its
delivery. The reply also reads in **Messages**, as part of the conversation;
the internal comment never does. A delivery names the message whose text it
sent (`message_id`, none for documents alone), which is how the page tells
them apart.

### Delivery

Each message to the requester shows its delivery under it in the request's
Messages section: "Sending", "Sent", or "Couldn't send: …" with **Retry**
and **Copy text**. Transient failures are retried up to five times; a
permanent one, such as MikeGC removed from the channel, a revoked token or
Graph consent withdrawn, says what to fix.

### Stopping MikeGC

While MikeGC waits on an answer, the request's details say "MikeGC is waiting
for the requester's answer (round 1 of 2)" with **Stop asking**. That, or any
other lawyer command on the request (assign, wait, resume, resolve, cancel,
edit), stops MikeGC asking for good: later answers are recorded but run no
AI. If it was waiting on the readiness check, preprocessing then runs with
what the request has.

### Visibility

A Slack or Teams thread is visible to everyone in the channel, and the send
controls say so ("Posts in the Slack thread in #legal-requests, visible to
everyone in the channel"). An email goes to the requester and those copied.

## Documents

PDF, Word, Excel and PowerPoint attachments are accepted: up to 10 per message
and 25 MB each. Anything else, or anything over those limits, is listed at the
end of the request's description so a reviewer can ask for it. Images
embedded in an email's body, such as signature logos, are left out without
being listed. Accepted documents become the request's documents, like ones a
member uploads, and every member can open them: Word and PowerPoint files are
converted for the viewer the same way, and they are stored under
`documents/intake-<organization ID>/` because MikeGC is not a user.

The document panel lists each document's versions, to view and download any
of them. While a request is open, any member who can see it can edit its
documents (as tracked changes, saved as new versions); once it is resolved or
cancelled they are read-only again, except to whoever uploaded them. A new
version of a document MikeGC recorded stays under the organization's
`intake-<organization ID>` folder.

### Processing a request in the Assistant

**Process in Assistant**, in the request page's header, opens a new Assistant
chat in the request's workspace with the request as a pill in the composer,
like an attached document, and a suggested prompt to process it. Nothing is
sent until the person sends it; they can change the prompt or remove the
pill. Sending the message with the pill names the request on the chat
(`chats.intake_request_id`), so every turn reads the request's
details, description, history and documents afresh, as the person asking
sees them, and puts the documents in scope without attaching them. The
request's text is fenced as data, never instructions, because it includes the
requester's words. While the request is open, the chat can edit its documents
with tracked changes. If the person loses access to the request, or the
request is deleted, the chat keeps its messages but reads nothing more of it.

MikeGC's preprocessing note reads in the activity as "MikeGC preprocessed this
request" (`intake_messages.purpose = 'preprocessing'`); its other notes, such
as a related-thread notice, stay comments.

## Setting up email

Company users email the intake address; MikeGC reads that mailbox and replies
as it. One mailbox per organization, on Microsoft 365 or Google Workspace.

### What counts as a request

- A new email with the intake address in To or Cc. A forward counts too: the
  forwarder is the requester, and the agent names the original sender in the
  summary.
- From an accepted **sender domain**. The list starts with the intake
  address's own domain; add the company's other domains (`example.com` also
  accepts its subdomains, such as `eu.example.com`). Mail from other domains
  is recorded as ignored, without creating a request.
- Authenticated by the sender's mail system: the receiving servers'
  `Authentication-Results` header must report `dmarc=pass`, or an SPF or DKIM
  pass aligned with the From address's domain. A forged From address is
  recorded as ignored.
- Automatic replies, such as out-of-office messages, bulk and list mail, and
  mail the mailbox sent itself are recorded as ignored, without their content.
- Not small talk: an email that clearly isn't a request ("how are you") gets
  an answer in its thread, replying to the sender's message, and nothing is
  recorded (see the start of this page).

A message in a request's thread from someone else at an accepted domain
becomes a new request, and the original request gets a note linking to it.
Outlook notifications usually arrive within a minute; Gmail is read every 60
seconds.

### Microsoft 365 (Outlook)

A shared mailbox is the recommended intake address: it needs no licence and
no one signs in to it. A user mailbox works too, and aliases or distribution
lists that deliver into it are fine.

1. In Microsoft Entra ID, register an app and create a client secret, or use
   the app Teams is set up with (see below).
2. Give the app the intake mailbox only, with Exchange's
   [RBAC for Applications](https://learn.microsoft.com/exchange/permissions-exo/application-rbac)
   in Exchange Online PowerShell: register the app with `New-ServicePrincipal`
   (using its Enterprise application's object ID), create a management scope
   that holds only the intake mailbox, and assign it the `Application
   Mail.ReadWrite` and `Application Mail.Send` roles within that scope.
   `Test-ServicePrincipalAuthorization` confirms which mailboxes it can open.
   Don't also grant `Mail.ReadWrite` or `Mail.Send` in Entra ID: Entra grants
   cover every mailbox in the tenant and are added to the scoped roles, so the
   scope would no longer limit the app. A new tenant must run
   `Enable-OrganizationCustomization` once before it can create the scope,
   and Exchange can take a while to apply it.
3. In MikeGC, open **Settings → Intake**, choose **Set up** on Outlook, and
   enter the mailbox address, tenant ID, client ID and client secret. When
   Teams is set up, **Use the same app as Teams** (on by default for a first
   connection) connects with the Teams app instead, without typing it again.
4. MikeGC checks it can open the mailbox, starts reading from now (mail
   already there isn't recorded), subscribes to new-mail notifications at its
   **notification URL** (`/webhooks/intake/graph/<id>`), and sends you a test
   email. If Microsoft can't reach the notification URL, the settings say so
   and MikeGC reads the mailbox every 15 minutes instead.

MikeGC marks recorded mail with the "MikeGC" category.

### Google Workspace (Gmail)

The intake address must be a licensed Workspace user account, such as
`intake@example.com`: the Gmail API reads only user mailboxes, so a Google
Group can't be connected, but a group can deliver into the account.

1. In Google Cloud, enable the Gmail API in a project, create a service
   account and download its JSON key. Organizations can skip this when the
   deployment has its own in `INTAKE_GMAIL_SERVICE_ACCOUNT_KEY`.
2. In the Google Admin console, under **Security → API controls → Domain-wide
   delegation**, add the service account's client ID with the scope
   `https://www.googleapis.com/auth/gmail.modify`. The Gmail dialog shows the
   client ID as soon as the key is pasted, or the deployment's when there is
   no key to paste.
3. In MikeGC, choose **Set up** on Gmail, enter the mailbox address and paste
   the JSON key. MikeGC reads the mailbox profile to check access, starts
   from its current history, and sends you a test email.

The pasted key is the organization's own: it is encrypted at rest like the
other channel secrets, never shown again, and used before the deployment's.
Reconnecting with the field left empty keeps it.

MikeGC marks recorded mail with the "MikeGC" label.

## Setting up Slack

Someone allowed to create apps in your Slack workspace does this once per
organization. Slack verifies the events URL as soon as you enter it, so enter
the app's credentials in MikeGC first.

1. Open [Slack app management](https://api.slack.com/apps), choose **Create
   New App → From an app manifest**, pick the workspace, and paste
   [`slack-intake-app-manifest.example.json`](slack-intake-app-manifest.example.json).
   It creates a bot called MikeGC that can read messages that mention it and
   the threads they're in, read and post files, name channels, look up the
   people in them, and reply under a member's name.
2. Install the app to the workspace. Copy its **Bot User OAuth Token**
   (`xoxb-…`, under **OAuth & Permissions**) and its **Signing Secret** (under
   **Basic Information**).
3. In MikeGC, open the organization's **Settings → Intake**, choose **Set up**
   on the Slack card, paste both, turn on **Record requests from Slack** and
   choose **Save** (or press Enter in a field). Nothing is saved until then;
   Cancel, Close or Escape discards it. Slack turns on once both are saved.
   MikeGC checks the token with Slack and shows the workspace it belongs to.
4. Back in the Slack app, open **Event Subscriptions**, turn events on, and
   paste MikeGC's **Events Request URL** from the settings page. Slack should
   show it as verified. Under **Subscribe to bot events**, add
   `app_mention`, `message.channels` and `message.groups`, save, and reinstall
   the app if Slack asks. The message events are how answers in a request's
   thread reach MikeGC without a mention; messages in threads no request is
   linked to are dropped without being stored.
5. Invite MikeGC to the channels people ask Legal in (`/invite @MikeGC`).
   Slack only tells MikeGC about mentions in channels it's a member of.

MikeGC's reply in the thread includes the request's subject and its reviewer,
so anyone in the channel can see them.

**Upgrading an existing app.** The requester loop needs `files:write` (to
post documents), `chat:write.customize` (to post under a lawyer's name),
`channels:read` and `groups:read` (to name the channel), and the two
`message.*` events. Add them from the manifest and reinstall the app. Until
then MikeGC still records requests and posts text without documents; the
Slack section names the missing scopes, and a request says "Reinstall the
Slack app to send documents".

## Setting up Teams

Each organization brings its own bot, as it brings its own Slack app.
Microsoft no longer creates new multi-tenant Azure bots, so the bot is
single-tenant. Your Microsoft 365 admin does this once:

1. In Microsoft Entra ID, register a single-tenant app and create a client
   secret.
2. Create an Azure Bot resource for that app ID. Set its messaging endpoint to
   MikeGC's **Teams events URL** from the Teams section
   (`/webhooks/intake/teams/<id>`) and turn on the Microsoft Teams channel.
3. Build a Teams app package from
   [`teams-intake-app-manifest.example.json`](teams-intake-app-manifest.example.json)
   (replace `YOUR-ENTRA-APP-ID`, add two icons), upload it to the
   organization's app catalog, and add it to the teams whose channels ask
   Legal. It declares the bot in team scope and the resource-specific consent
   permission `ChannelMessage.Read.Group`, which a team owner consents to when
   adding the app, so MikeGC receives thread replies without a mention.
4. Optional, for documents: grant the app the Microsoft Graph application
   permission `Sites.Selected` for the chosen teams' sites (preferred over
   tenant-wide `Files.ReadWrite.All`), with admin consent.
5. In MikeGC, choose **Set up** on the Teams card, paste the app ID, tenant
   ID and client secret, turn on **Record requests from Teams** and choose
   **Save**. MikeGC requests a token to check them and shows whether document
   access works. When Outlook is connected, **Use the same app as Outlook**
   (on by default for a first setup) uses the mailbox's Entra app instead,
   without typing it again.

Outlook and Teams keep their own Entra app settings, so each channel can have
its own app; a separate app per channel is safer, since a leaked secret then
reaches only one. Reusing the other channel's app copies its tenant ID, client
ID and client secret: MikeGC keeps an encrypted copy for each channel, so
changing one channel's app or secret later doesn't change the other's.

Every request from Teams carries a Bot Connector token, which MikeGC checks
against Bot Framework's signing keys, the bot's app ID, the activity's service
URL and the configured tenant before reading it. Files shared in the channel
are read through Graph when document access works, and listed as not attached
otherwise. MikeGC's replies go through the Bot Connector; a resolution's
documents are uploaded to the channel's files folder, under
`MikeGC/<request subject>/`, and linked from the message, so channel members
open them with their existing access. Without document access, the message
names them and says to ask Legal for a copy. Whether Teams delivers thread
replies from private and shared channels depends on Microsoft; standard
channels are supported.

## How it works

- **Receiving.** Webhooks arrive under `/webhooks/intake/` on the API,
  outside the signed-in `/intake` API. Slack requests are checked against the
  signing secret (HMAC-SHA256 over the raw body, rejected after five
  minutes). Teams activities must carry a Bot Connector JWT signed with Bot
  Framework's keys (cached, refreshed on an unknown key ID), issued by
  `https://api.botframework.com` to the bot's app ID, within its lifetime
  (five minutes' skew), for the activity's own service URL and the configured
  tenant. Graph notifications must echo the client state MikeGC set, of which
  it keeps only a SHA-256 hash; they hold no content, so a forged one can only
  make MikeGC read real mail. Gmail is polled (`intake.mailbox.poll`, a
  self-rescheduling job per mailbox), and so is Outlook every 15 minutes as a
  backstop, with its subscription renewed every three days.
- **Routing.** Each channel's event is either a message in a thread linked to
  a request (`intake_channel_links`), stored in `intake_inbound` as a reply,
  or a new request: a mention of MikeGC in an unlinked thread, or a new email
  to the intake address. Both are handed to the `intake.agent` job, which
  takes the reply branch or the new-message branch by the stored row's kind.
  Anything else (chatter in an unlinked thread, bots' own
  messages, edits and deletions) is acknowledged and dropped after one indexed
  link lookup, without storing its content. An email reply is matched by its
  Outlook `conversationId` or Gmail `threadId`, or else by a Message-ID in its
  `In-Reply-To` or `References` that MikeGC saw or sent in the thread
  (`intake_email_message_ids`).
- **Recording.** Each message is stored once in `intake_inbound`, keyed by its
  Slack channel and timestamp, its Teams activity ID or its email
  `Message-ID`, so a webhook delivered again records nothing new. Email
  attachments are stored temporarily until the message is handled. The
  `intake.agent` job then runs the intake agent (`intake.agent.ts`) and
  saves its plan on the message, then answers in the thread
  (`intake_conversations` counts MikeGC's answers and keeps their text) or
  records the request with
  `intake_submit_automated`, links its thread with `intake_link_thread`, makes
  its documents and links them with `intake_attach_automated`, and asks
  (`intake_ask_automated`) or acknowledges (`intake_acknowledge_automated`). A
  retried job reuses the request and documents it already made and never
  acknowledges twice. A message that still fails after its retries is
  recorded as failed, with a reason, in `intake_inbound`, and MikeGC says so
  in a Slack thread.
- **Replies.** The `intake.agent` job's reply branch reads the reply from its channel,
  records it with `intake_reply_automated`, adds its files, and then queues
  the next round of `intake.preprocess` for an answer to the readiness check
  (deduplicated per request and round, `intake.preprocess:<request>:<round>`),
  or runs the agent on an open request: `intake_update_automated` changes the
  details it planned, skipping any in the request's `member_edited_fields`,
  `intake_ask_automated` asks once more or
  `intake_settle_clarify_automated` returns a request whose rule is chosen
  to New or In progress, and `intake_answer_automated` posts MikeGC's answer
  without changing the request's state.
- **Outbox.** Every requester-facing message (an acknowledgement, a question,
  MikeGC's answer or a resolution reply) is an `intake_outbound` row written in the same
  transaction as the message it carries, and sent by the `intake.deliver`
  job through its channel's adapter. Before a retry (never on the first
  attempt) the adapter asks the channel whether an earlier attempt landed:
  Slack by the message's metadata, Outlook by an extended property in Sent
  Items, Gmail by its Message-ID (or an `X-MikeGC-Outbound` header in the
  thread), Teams by the bot's message with the same text in the thread. Each
  document's channel ID is saved as it lands, so a retry posts only the rest.
  Failures store a sentence MikeGC writes from a known code, never a
  provider's response.
- **Questions are untrusted output.** The thread is untrusted, and the
  questions go to people in the business, so at most three are posted, each
  one line of at most 300 characters; any with a link, an email address, a
  mention or markup is dropped; each is escaped for its channel; and MikeGC's
  own wording frames them ("One quick question so it gets to the right
  person:" while choosing a rule, "A couple of things Legal will need before
  they start:" for the readiness check). The models are asked to phrase them
  the way a colleague in Legal would in a chat. If every
  question is dropped, the stage counts as ready. Lawyers write every
  resolution, and documents go only to the request's own thread when a lawyer
  ticks them.
- **Preprocessing.** When a request's rule asks for it, preprocessing reads
  the documents through the documents module's organization-owned path, runs
  the readiness check, writes tracked changes as a new version through the
  same module, and posts its note with `intake_note_automated`. The note's ID
  is fixed per request, so it is posted once however many rounds run; a job
  that fails for good posts a short note saying preprocessing couldn't
  finish.
- **Secrets.** The Slack signing secret and bot token, the Graph client
  secret and the Teams client secret are encrypted at rest with
  `MCP_CONNECTORS_ENCRYPTION_SECRET`, like connector credentials, are
  write-only in the UI, and are never logged.
- **Retention.** A message's content is kept only until it is handled; the
  request then holds it. Threads, the outbox and Message-IDs cascade from
  their request, so deleting a request, deleting all intake requests in
  **Privacy & Data**, and purging the organization remove them; received
  messages go too, and a database trigger hands the attachments of any still
  waiting to the storage worker. A reply arriving while its request is purged
  is settled without its content. A member's assignment rules are deleted
  when they leave the organization.
- **Not recorded.** Changes to these settings are not written to the audit
  log yet. Each message sent to a requester is part of the request's activity,
  with its author and delivery status.

## Deployment

Apply `backend/migrations/20261102_02_intake_automation.sql`,
`backend/migrations/20261102_03_intake_assignment_rules.sql`,
`backend/migrations/20261102_04_intake_remove_timezone.sql`,
`backend/migrations/20261102_05_intake_rule_preprocessing.sql`,
`backend/migrations/20261103_01_intake_triage_always_on.sql`,
`backend/migrations/20261103_02_intake_triage_model.sql`,
`backend/migrations/20261103_03_intake_preprocessing_model.sql`,
`backend/migrations/20261103_04_intake_replace_rules.sql`,
`backend/migrations/20261103_05_intake_requester_loop.sql`,
`backend/migrations/20261103_06_intake_mailbox.sql`,
`backend/migrations/20261103_07_intake_teams.sql` and
`backend/migrations/20261104_01_intake_gmail_service_account.sql` before starting
the new build. The second turns any note of what a member handles into a rule
assigning to them, and stops if an organization has more than 100 notes, more
than the 100 rules it can hold. The third removes the timezone that requests kept with
their target date, which is overdue once it has passed where the viewer is.
The fourth adds AI preprocessing to rules and lets MikeGC post notes. The
fifth removes the switch that turned AI triage off, so it runs for every
organization, including any that had switched it off. The sixth adds the
triage model, and the seventh the preprocessing model; settings that already
exist have neither, so an admin chooses them before triage and preprocessing
run again. The eighth saves an organization's rules in one transaction, so
two saves at once can't delete each other's rules. The ninth adds the
requester loop: thread links, the outbox, replies, MikeGC's clarifying stages
and rounds, the New reply flag, the lawyer's send options on wait and resolve,
and **Stop asking**. Its command boundary takes new arguments, so an older
binary can't work requests once it has run; roll application code forward.
The tenth connects the intake mailbox and retires Postmark: it drops the
Postmark token columns and turns email off for organizations that used it. The eleventh adds Teams,
and the twelfth an organization's own Gmail service account.

`backend/migrations/20261111_01_intake_agent.sql` adds what the intake agent
needs: `intake_requests.member_edited_fields`, which `intake_edit_request` now
fills with each detail a member changes; `intake_update_automated`, which
changes a request's details as MikeGC; and `intake_conversations.replies`,
MikeGC's own answers in a thread with no request. Apply it before starting the
new build; the old build keeps working once it has run.

`20261111_03_intake_retire_postmark.sql` removes what was left of Postmark:
requests recorded through it take the organization's connected mailbox
(Outlook or Gmail) as their source, or Manual when none is connected; Postmark
mail still waiting is deleted; the `'email'` source and
`intake_automation.email_reconnect_notice` are dropped. The old webhook URL is
gone and answers `404`. `20261111_04_intake_answer_automated.sql` adds
`intake_answer_automated`, which MikeGC's answers in a request's thread use.
Apply both before starting the new build. Jobs queued as `intake.inbound` or
`intake.reply` by an older build aren't run by the new one, which queues
`intake.agent`: let the queue drain before upgrading.

`INTAKE_GMAIL_SERVICE_ACCOUNT_KEY` (a Google service account's JSON key) is
optional: it serves Gmail mailboxes whose organization didn't paste its own
key. Otherwise no new environment variables are
required: the webhook and notification URLs are built from `API_PUBLIC_URL`,
the request links in members' notes from `FRONTEND_URL`, and secrets are
encrypted with `MCP_CONNECTORS_ENCRYPTION_SECRET` (or
`USER_API_KEYS_ENCRYPTION_SECRET`). The backend gains the `jose` (Bot
Framework token checks) and `nodemailer` (Gmail MIME building only, never
SMTP) dependencies. The jobs `intake.agent`, `intake.deliver` and
`intake.mailbox.poll` run on the existing job runner; the maintenance sweep
restarts a connected mailbox's poll job if it ever stops, and queues again a
message to a requester left pending for 15 minutes without a job.

Webhook deliveries have their own rate limit, 120 a minute per sending
address, which `RATE_LIMIT_WEBHOOK_MAX` and
`RATE_LIMIT_WEBHOOK_WINDOW_MINUTES` can change. Slack, Teams and Graph send
every organization's deliveries from the same addresses, so their webhooks are
limited per organization's webhook URL instead, 600 a minute by default
(`RATE_LIMIT_SLACK_WEBHOOK_MAX`, `RATE_LIMIT_TEAMS_WEBHOOK_MAX`,
`RATE_LIMIT_GRAPH_WEBHOOK_MAX`). One sending address is also held to 3,000 a
minute across all of those URLs together (`RATE_LIMIT_CHANNEL_WEBHOOK_IP_MAX`),
so a client can't get around the per-URL limit by rotating URLs.

Every webhook must reach the API over public HTTPS. The frontend's `/api`
gateway forwards them unchanged, including Slack's signature headers and the
raw body Slack signs, so `API_PUBLIC_URL` can be the usual same-origin
gateway. For local development, run a tunnel and set
`API_PUBLIC_URL` to it, as for the Slack connector in
[connectors.md](connectors.md).
