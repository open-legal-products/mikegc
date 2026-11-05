// Demo workspace for the launch film's product shots. Every person, company and
// document here is fictional. The state is mutable so a capture can move the
// Acme request through the requester loop.

const ORG = "org-alia";
const NOW = new Date("2026-11-09T10:16:00Z"); // Mon 9 Nov 2026, London

// Profile photos: public-domain, AI-generated faces in avatars/ (see avatars/avatars.json).
const fs = require("fs");
const path = require("path");
const photo = (key) => {
    const file = path.join(__dirname, "avatars", `${key}.jpg`);
    return fs.existsSync(file) ? `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` : null;
};
const PRIYA = { user_id: "u-priya", display_name: "Priya Shah", email: "priya@alia.ai", profile_photo: photo("priya") };
const SAM = { user_id: "u-sam", display_name: "Sam Ortiz", email: "sam@alia.ai", profile_photo: photo("sam") };
const DANA = { user_id: "u-dana", display_name: "Dana Kim", email: "dana@alia.ai", profile_photo: photo("dana") };
const MEMBERS = [PRIYA, SAM, DANA];

const iso = (d) => d.toISOString();
const daysAgo = (n, h = 10, m = 0) => {
    const d = new Date(NOW);
    d.setUTCDate(d.getUTCDate() - n);
    d.setUTCHours(h, m, 0, 0);
    return d;
};
const dateOnly = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

const ACME_ID = "req-acme-nda";

// ---- the queue ---------------------------------------------------------------
// [subject, requester, team, state, assignee, createdDaysAgo, targetOffsetDays|null, source, updatedDaysAgo]
const ROWS = [
    ["Harbor & Pine renewal check", "Tom Becker", "Finance", "in_review", SAM, 4, 8, "outlook", 0.6],
    ["Launch page claim check", "Alex Rivera", "Marketing", "submitted", null, 0, 3, "teams", 0.05],
    ["Acme order form, 2027 pricing", "Jordan Lee", "Sales", "needs_information", DANA, 6, 5, "slack", 1],
    ["Office lease extension", "Grace Liu", "Workplace", "in_review", DANA, 12, -2, "manual", 2],
    ["Supplier code of conduct update", "Omar Haddad", "Procurement", "in_review", SAM, 16, -4, "outlook", 3],
    ["Event sponsorship terms", "Lena Park", "Marketing", "needs_information", PRIYA, 9, 2, "gmail", 1.5],
    ["Open-source licence check", "Ben Carter", "Engineering", "in_review", SAM, 5, 10, "slack", 0.8],
    ["Referral programme terms", "Nina Patel", "Sales", "submitted", null, 1, 6, "slack", 0.9],
    ["Harbor & Pine SOW 2", "Tom Becker", "Finance", "in_review", PRIYA, 8, -1, "outlook", 2.5],
    ["Data retention question", "Chris Novak", "Product", "in_review", PRIYA, 2, 9, "teams", 0.4],
    ["Customer audit request", "Maya Chen", "Procurement", "needs_information", SAM, 11, 3, "gmail", 4],
    ["Pricing page wording", "Alex Rivera", "Marketing", "in_review", DANA, 7, 1, "teams", 1.2],
];
const CLOSED = [
    ["Brightwater MSA amendment", "Maya Chen", "Procurement", "resolved", PRIYA, 52],
    ["Acme mutual NDA", "Jordan Lee", "Sales", "resolved", PRIYA, 49],
    ["Consultant agreement", "Grace Liu", "Workplace", "resolved", DANA, 47],
    ["Harbor & Pine DPA", "Tom Becker", "Finance", "resolved", SAM, 45],
    ["Trademark search, product name", "Lena Park", "Marketing", "resolved", SAM, 43],
    ["Referral bonus policy", "Nina Patel", "Sales", "resolved", DANA, 40],
    ["Webinar recording consent", "Lena Park", "Marketing", "resolved", PRIYA, 38],
    ["Vendor security addendum", "Omar Haddad", "Procurement", "resolved", SAM, 36],
    ["Acme reseller terms", "Jordan Lee", "Sales", "resolved", PRIYA, 33],
    ["Employee handbook update", "Grace Liu", "Workplace", "resolved", DANA, 31],
    ["Brightwater order form", "Maya Chen", "Procurement", "resolved", SAM, 29],
    ["Beta programme terms", "Chris Novak", "Product", "resolved", PRIYA, 27],
    ["Customer reference request", "Alex Rivera", "Marketing", "resolved", DANA, 24],
    ["Data processing question", "Chris Novak", "Product", "resolved", SAM, 22],
    ["Harbor & Pine NDA", "Tom Becker", "Finance", "resolved", PRIYA, 20],
    ["Conference speaker agreement", "Lena Park", "Marketing", "resolved", DANA, 18],
    ["Acme renewal notice", "Jordan Lee", "Sales", "resolved", SAM, 15],
    ["Contractor IP assignment", "Ben Carter", "Engineering", "resolved", PRIYA, 13],
    ["Survey prize draw rules", "Alex Rivera", "Marketing", "resolved", DANA, 10],
    ["Brightwater SLA credits", "Maya Chen", "Procurement", "resolved", SAM, 8],
    ["Partner logo permission", "Lena Park", "Marketing", "resolved", PRIYA, 6],
    ["Open-source contribution policy", "Ben Carter", "Engineering", "resolved", DANA, 4],
    ["Price increase letter", "Tom Becker", "Finance", "resolved", SAM, 2],
    ["Brightwater invoice dispute", "Maya Chen", "Procurement", "resolved", DANA, 1],
    ["Gift card terms", "Nina Patel", "Sales", "cancelled", null, 19],
    ["Duplicate: Acme NDA", "Jordan Lee", "Sales", "cancelled", null, 35],
];

// Everyone works at Alia, a fictional AI startup: first name @alia.ai.
const email = (name) => name.split(" ")[0].toLowerCase() + "@alia.ai";

let requests = [];
let n = 0;
for (const [subject, requester, team, state, assignee, created, target, source, updated] of ROWS) {
    const c = daysAgo(created, 9 + (n % 7), (n * 13) % 60);
    requests.push({
        id: `req-${++n}`, subject, requester_name: requester, requester_email: email(requester),
        requester_team: team, requested_by_date: target === null ? null : dateOnly(plusDays(NOW, target)),
        state, version: 3, assignee_id: assignee?.user_id ?? null, assignee_name: assignee?.display_name ?? null,
        created_at: iso(c), updated_at: iso(new Date(NOW.getTime() - updated * 86400000)),
        clarify_stage: null, new_reply: false, unread_replies: 0, source,
    });
}
for (const [subject, requester, team, state, assignee, created] of CLOSED) {
    const c = daysAgo(created, 9 + (n % 7), (n * 17) % 60);
    requests.push({
        id: `req-${++n}`, subject, requester_name: requester, requester_email: email(requester),
        requester_team: team, requested_by_date: dateOnly(plusDays(c, 7)),
        state, version: 5, assignee_id: assignee?.user_id ?? null, assignee_name: assignee?.display_name ?? null,
        created_at: iso(c), updated_at: iso(plusDays(c, 1 + (n % 4))),
        clarify_stage: null, new_reply: false, unread_replies: 0, source: "slack",
    });
}

// The film's request.
const ACME_CREATED = new Date("2026-11-09T10:14:00Z");
const acme = {
    id: ACME_ID, org_id: ORG, subject: "Review Acme's NDA",
    description: "Can someone review Acme's NDA by Friday? It's attached.\n\nPosted by Jordan Lee in #legal-requests.",
    requester_name: "Jordan Lee", requester_email: "jordan@alia.ai", requester_team: "Sales",
    requested_by_date: "2026-11-13", state: "in_review", version: 2,
    assignee_id: PRIYA.user_id, assignee_name: PRIYA.display_name,
    created_at: iso(ACME_CREATED), updated_at: iso(new Date("2026-11-09T10:15:20Z")),
    clarify_stage: null, new_reply: false, unread_replies: 0,
    created_by: null, created_by_name: "MikeGC", source: "slack",
    clarify_rounds: 0, clarify_max_rounds: 2, last_reply_at: null,
    conversation: {
        source: "slack", channel_name: "legal-requests", team_name: null,
        permalink: "https://alia.slack.com/archives/C000/p000", mailbox: null, to: [], cc: [],
        max_attachment_bytes: null, documents: true,
    },
};
requests.unshift(acme);

// The email scenario: Maya emails the intake mailbox; MikeGC records it.
const BW_ID = "req-bw-dpa";
const brightwater = {
    id: BW_ID, org_id: ORG, subject: "Brightwater DPA sign-off",
    description: "Hi Legal,\n\nBrightwater sent over their DPA for the product analytics rollout (attached). We need sign-off this week so they can start on Monday.\n\nThanks,\nMaya",
    requester_name: "Maya Chen", requester_email: "maya@alia.ai", requester_team: "Procurement",
    requested_by_date: "2026-11-13", state: "in_review", version: 2,
    assignee_id: PRIYA.user_id, assignee_name: PRIYA.display_name,
    created_at: "2026-11-09T09:42:00Z", updated_at: "2026-11-09T09:42:30Z",
    clarify_stage: null, new_reply: false, unread_replies: 0,
    created_by: null, created_by_name: "MikeGC", source: "gmail",
    clarify_rounds: 0, clarify_max_rounds: 2, last_reply_at: null,
    conversation: {
        source: "gmail", channel_name: null, team_name: null, permalink: null,
        mailbox: "legal@alia.ai", to: ["maya@alia.ai"], cc: [],
        max_attachment_bytes: 25000000, documents: true,
    },
};
requests.splice(1, 0, brightwater);
const bwEvents = [
    { id: 11, kind: "submitted", from_state: null, to_state: "submitted", actor_id: null, actor_name: "MikeGC", assignee_name: null, created_at: "2026-11-09T09:42:00Z" },
    { id: 12, kind: "assign", from_state: "submitted", to_state: "in_review", actor_id: null, actor_name: "MikeGC", assignee_name: "Priya Shah", created_at: "2026-11-09T09:42:04Z" },
];
const bwDocuments = [{
    document_id: "doc-bw-dpa", filename: "Brightwater_DPA.docx", file_type: "docx", size_bytes: 71268, status: "ready",
    added_by_name: "Maya Chen", created_at: "2026-11-09T09:42:01Z", message_id: null, revised: false,
}];

const PREPROCESS_NOTE = [
    "I reviewed Acme_NDA.docx against the NDA playbook and marked it up with tracked changes.",
    "",
    "Mutuality: Acme's form is one-way and protects only Acme's information. The playbook asks for a mutual NDA when both sides share information, so I made the obligations mutual throughout (sections 1 to 13). Worth confirming with Jordan what we'll share.",
    "",
    "Term: obligations run for 7 years after the last disclosure (section 8.2). The playbook allows 3, so I changed it to 3. Trade secrets stay protected for as long as they're trade secrets.",
    "",
    "Residuals: section 6 lets Acme use anything its people remember from our discussions. The playbook rejects residuals clauses, so I deleted it.",
    "",
    "No change needed: Delaware law and courts (section 12) and the ban on training models with the other side's information (section 2.1(d)) are within the playbook.",
].join("\n");

let messages = [
    {
        id: "msg-pre", kind: "note", body: PREPROCESS_NOTE, automated: true, purpose: "preprocessing",
        author_id: null, author_name: "MikeGC", created_at: "2026-11-09T10:15:20Z",
        external_author: null, delivery: null,
    },
];
let events = [
    { id: 1, kind: "submitted", from_state: null, to_state: "submitted", actor_id: null, actor_name: "MikeGC", assignee_name: null, created_at: "2026-11-09T10:14:00Z" },
    { id: 2, kind: "assign", from_state: "submitted", to_state: "in_review", actor_id: null, actor_name: "MikeGC", assignee_name: "Priya Shah", created_at: "2026-11-09T10:14:05Z" },
];
const ORIGINAL_DOC = {
    document_id: "doc-acme-nda", filename: "Acme_NDA.docx",
    file_type: "docx", size_bytes: 52416, status: "ready",
    added_by_name: "Jordan Lee", created_at: "2026-11-09T10:14:02Z", message_id: null, revised: true,
};
let documents = [ORIGINAL_DOC];

// ---- dashboard -------------------------------------------------------------------
function dashboard() {
    const open = requests.filter((r) => ["submitted", "in_review", "needs_information"].includes(r.state));
    const today = dateOnly(NOW);
    const overdue = open.filter((r) => r.requested_by_date && r.requested_by_date < today).length;
    const weeks = [
        ["2026-09-14", 4, 3], ["2026-09-21", 5, 4], ["2026-09-28", 6, 5], ["2026-10-05", 4, 6],
        ["2026-10-12", 7, 5], ["2026-10-19", 6, 7], ["2026-10-26", 8, 6], ["2026-11-02", 9, 5],
    ].map(([week_start, created, resolved]) => ({ week_start, created, resolved }));
    const per = (m) => {
        const mine = open.filter((r) => r.assignee_id === m.user_id);
        return {
            assignee_id: m.user_id, name: m.display_name, photo: m.profile_photo,
            open: mine.length,
            waiting: mine.filter((r) => r.state === "needs_information").length,
            overdue: mine.filter((r) => r.requested_by_date && r.requested_by_date < today).length,
        };
    };
    return {
        open: open.length,
        new: open.filter((r) => r.state === "submitted").length,
        in_progress: open.filter((r) => r.state === "in_review").length,
        waiting: open.filter((r) => r.state === "needs_information").length,
        unassigned: open.filter((r) => !r.assignee_id).length,
        overdue,
        created: 29, resolved: 24, created_days: 30, resolved_days: 30, median_days: 30,
        weeks_shown: 8, median_hours_to_resolve: 46,
        weeks,
        workload: MEMBERS.map(per).sort((a, b) => b.open - a.open),
    };
}

// ---- automation / rules ------------------------------------------------------------
const RULES = [
    { condition: "The request is about an NDA", assignee_id: PRIYA.user_id, preprocess: true, preprocess_with: { kind: "playbook", id: "pb-nda", name: "NDA playbook" } },
    { condition: "The request is about a DPA or another data protection question", assignee_id: PRIYA.user_id, preprocess: true, preprocess_with: { kind: "playbook", id: "pb-dpa", name: "DPA playbook" } },
    { condition: "The request is a renewal, order form or statement of work", assignee_id: SAM.user_id, preprocess: true, preprocess_with: null },
    { condition: "The request asks about marketing claims, advertising or a website's wording", assignee_id: DANA.user_id, preprocess: false, preprocess_with: null },
    { condition: "The request is about a lease, an office or a facilities contract", assignee_id: DANA.user_id, preprocess: false, preprocess_with: null },
];
const automation = () => ({
    email: {
        enabled: true, provider: "gmail", mailbox: "legal@alia.ai", allowed_domains: ["alia.ai"], from_name: "Legal",
        graph: { tenant_id: null, client_id: null, secret_set: false }, notification_url: "",
        gmail: { client_id: "1234567890", key_set: true, deployment_key: true },
        status: { subscription_expires_at: null, last_read_at: "2026-11-09T10:15:00Z", error: null },
        needs_reconnect: false,
    },
    slack: { enabled: true, events_url: "https://mikegc.alia.ai/api/intake/slack/events", configured: true, team_id: "T000", team_name: "Alia", bot_user_id: "U000", missing_scopes: [], message_events_seen: true },
    teams: { enabled: true, events_url: "https://mikegc.alia.ai/api/intake/teams/messages", configured: true, app_id: "app", tenant_id: "tenant", files_access: true },
    models: { available: ["claude-haiku-5-5", "claude-sonnet-5-5"], triage: "claude-haiku-5-5", triage_available: true, preprocessing: "claude-sonnet-5-5", preprocessing_available: true },
    rules: RULES,
    recent: [],
});

// ---- notifications (the toast) ------------------------------------------------------
let pendingNotifications = [];
function queueNewRequestToast() {
    pendingNotifications.push({
        workspace: ORG, workspace_name: "Alia", request_id: ACME_ID, subject: acme.subject,
        kind: "new_request", change: "assign", actor_name: null, automated: true, channel: null,
        more: 0, created_at: "2026-11-09T10:15:21Z",
    });
}

// ---- film steps -----------------------------------------------------------------
const steps = {
    // Priya asked Jordan a question with Message requester.
    asked() {
        if (messages.some((m) => m.id === "msg-q")) return;
        messages.push({
            id: "msg-q", kind: "question", body: "Is this mutual? Their draft only protects Acme.",
            author_id: PRIYA.user_id, author_name: PRIYA.display_name, created_at: "2026-11-09T10:21:00Z",
            external_author: null,
            delivery: { outbound_id: "out-q", kind: "question", status: "sent", error: null, sent_at: "2026-11-09T10:21:02Z", message_id: "msg-q", documents: [] },
        });
        events.push({ id: 3, kind: "wait", from_state: "in_review", to_state: "needs_information", actor_id: PRIYA.user_id, actor_name: PRIYA.display_name, assignee_name: null, created_at: "2026-11-09T10:21:00Z" });
        acme.state = "needs_information";
        acme.version = 3;
    },
    // Jordan answered in the Slack thread.
    replied() {
        steps.asked();
        if (messages.some((m) => m.id === "msg-r")) return;
        messages.push({
            id: "msg-r", kind: "reply", body: "Mutual. We're sharing roadmaps.",
            author_id: null, author_name: "Jordan Lee", created_at: "2026-11-09T10:24:00Z",
            external_author: { name: "Jordan Lee", email: "jordan@alia.ai", source: "slack", user_id: "U-JORDAN" },
            delivery: null,
        });
        events.push({ id: 4, kind: "resume", from_state: "needs_information", to_state: "in_review", actor_id: null, actor_name: null, assignee_name: null, created_at: "2026-11-09T10:24:00Z" });
        acme.state = "in_review";
        acme.new_reply = true;
        acme.unread_replies = 1;
        acme.last_reply_at = "2026-11-09T10:24:00Z";
        acme.updated_at = "2026-11-09T10:24:00Z";
        acme.version = 4;
    },
    resolved() {
        steps.replied();
        if (acme.state === "resolved") return;
        messages.push({
            id: "msg-res", kind: "resolution",
            body: "Approved as a mutual NDA. I've made the confidentiality obligations two-way, cut the term to 3 years and removed the residuals clause. Send Acme the attached redline.",
            author_id: PRIYA.user_id, author_name: PRIYA.display_name, created_at: "2026-11-09T10:31:00Z",
            external_author: null, delivery: null,
        });
        events.push({
            id: 5, kind: "resolve", from_state: "in_review", to_state: "resolved", actor_id: PRIYA.user_id, actor_name: PRIYA.display_name, assignee_name: null, created_at: "2026-11-09T10:31:00Z",
            delivery: { outbound_id: "out-a", kind: "answer", status: "sent", error: null, sent_at: "2026-11-09T10:31:03Z", message_id: "msg-res", documents: [{ document_id: "doc-acme-nda", filename: "Acme_NDA.docx", left_out: false }] },
        });
        acme.state = "resolved";
        acme.new_reply = false;
        acme.unread_replies = 0;
        acme.version = 5;
    },
};

function detail(r = acme) {
    const open = ["submitted", "in_review", "needs_information"].includes(r.state);
    return {
        ...r,
        capabilities: {
            edit: open, assign: open, note: true, wait: r.state === "in_review", resume: r.state === "needs_information",
            resolve: open, cancel: open, reopen: !open, delete: true, send_to_requester: open, stop_asking: false,
        },
    };
}

function summary(r) {
    const { org_id, description, created_by, created_by_name, source, clarify_rounds, clarify_max_rounds, last_reply_at, conversation, capabilities, ...rest } = r;
    return { ...rest, capabilities: { assign: true, cancel: true, delete: true } };
}

const PROFILE = {
    displayName: "Priya Shah", organisation: "Alia", jurisdiction: "England and Wales",
    practiceSetting: "in_house", professionalTitle: null, practiceAreas: ["Commercial"], profilePhoto: PRIYA.profile_photo,
    onboardingVersion: 99, onboardingComplete: true, passwordSet: true, messageCreditsUsed: 0,
    creditsResetDate: "2026-12-01", creditsRemaining: 100, tier: "pro", titleModel: null, tabularModel: null,
    memoryCuratorModel: null, subagentModel: null, subagentReasoning: null, lastSelectedChatModel: "claude-opus-5-5",
    lastSelectedReasoningLevel: "medium", mfaOnLogin: false, legalResearchUs: false, quickActionsVisible: true,
    responseDetailsVisible: false, darkMode: false, projectMemoryDefault: false, apiKeyStatus: { claude: true },
};

// "Process in Assistant" on the Brightwater request: Priya sends the suggested
// prompt, and the Assistant reviews the DPA and redlines it.
const PROCESS_PROMPT = "Process this intake request: work out what is being asked and what is still missing, review it and its documents for the main legal issues and risks, and recommend the next steps.";
const BW_CHAT = {
    id: "chat-bw-dpa", title: "Brightwater DPA sign-off", user_id: PRIYA.user_id, project_id: null,
    model: "claude-opus-5-5", created_at: "2026-11-09T10:18:00Z", is_owner: true, access_role: "owner",
};
const ann = (n, deleted_text, inserted_text, context_before, context_after, reason) => ({
    type: "edit_data", kind: "edit", edit_id: `bw-edit-${n}`, document_id: "doc-bw-dpa", version_id: "v2", version_number: 2,
    change_id: `bw-change-${n}`, deleted_text, inserted_text, context_before, context_after, reason, status: "pending",
});
const BW_MESSAGES = [
    {
        id: "bw-m1", chat_id: "chat-bw-dpa", role: "user", content: PROCESS_PROMPT,
        intake: { id: BW_ID, title: "Brightwater DPA sign-off" }, created_at: "2026-11-09T10:18:00Z",
    },
    {
        id: "bw-m2", chat_id: "chat-bw-dpa", role: "assistant", created_at: "2026-11-09T10:18:05Z",
        content: [
            { type: "doc_read", filename: "Brightwater_DPA.docx", document_id: "doc-bw-dpa", version_id: "v1", version_number: 1 },
            { type: "content", text: [
                "**What's being asked.** Maya needs sign-off on Brightwater's data processing addendum for the product analytics rollout by Friday 13 November, so Brightwater can start on Monday.",
                "",
                "**Main issues**",
                "1. **Sub-processors (section 6.2).** Brightwater can add sub-processors at its discretion. We should get 30 days' notice, a right to object and a way out if we can't agree.",
                "2. **Breach notice (section 8.1).** \"Without undue delay\" has no outer limit. 48 hours leaves us time to meet our own 72-hour deadline under the GDPR.",
                "3. **Liability (section 13.1).** Data protection claims fall under the Agreement's general cap. A separate cap of twice the annual fees is more usual for analytics data.",
                "",
                "International transfers (section 10) use the Standard Contractual Clauses and the UK Addendum, and the security measures in Annex 2 include SOC 2 Type II, encryption and MFA. Both are fine as drafted.",
            ].join("\n") },
            { type: "doc_edited", filename: "Brightwater_DPA.docx", document_id: "doc-bw-dpa", version_id: "v2", version_number: 2, download_url: "",
              annotations: [
                ann(1, "additional Sub-processors at its discretion", "an additional or replacement Sub-processor after giving Customer at least thirty (30) days' prior written notice, during which Customer may object on reasonable grounds relating to data protection. If Customer objects, the parties shall discuss its concerns in good faith and, if they cannot resolve them, Customer may terminate the affected Services without penalty", "Brightwater may engage ", ".", "Notice and a right to object"),
                ann(2, "", ", and in any event within forty-eight (48) hours,", "Brightwater shall notify Customer without undue delay", " after becoming aware of a Personal Data Breach.", "A fixed outer limit"),
                ann(3, "Each party's liability arising out of or in connection with this Addendum is subject to the limitations and exclusions of liability in the Agreement.", "Brightwater's aggregate liability arising out of or in connection with this Addendum shall not exceed two times (2x) the fees paid or payable by Customer under the Agreement in the twelve (12) months preceding the event giving rise to the claim. This limit is separate from, and in addition to, any limitation of liability in the Agreement.", "", "", "A separate cap for data protection"),
              ] },
            { type: "content", text: [
                "I've made these three changes as tracked changes in Brightwater_DPA.docx.",
                "",
                "**Still missing.** Annex 3, the list of current sub-processors, is blank. Ask Maya to get it from Brightwater.",
                "",
                "**Next steps.** Send Brightwater the redline, and approve once Annex 3 arrives.",
            ].join("\n") },
        ],
    },
];

const unknown = new Set();

/** Answer one API call. Returns [status, body] or null when unknown. */
function handle(method, path, query, body) {
    const p = path.replace(/^\/api/, "");
    if (p === "/auth/session") return [200, { user: { id: PRIYA.user_id, email: PRIYA.email } }];
    if (p === "/user/profile") return [200, PROFILE];
    if (p === "/orgs") return [200, [{ id: ORG, name: "Alia", created_by: PRIYA.user_id, role: "owner", member_count: 3, logo_updated_at: null }]];
    if (p === "/intake/notifications/claim") {
        const out = pendingNotifications;
        pendingNotifications = [];
        return [200, { notifications: out }];
    }
    const m = p.match(/^\/intake\/([^/]+)(\/.*)?$/);
    if (m) {
        const sub = m[2] || "";
        if (sub === "/members") return [200, MEMBERS];
        if (sub === "/requesters") return [200, [...new Set(requests.map((r) => r.requester_name))].map((name) => ({ name, email: email(name) }))];
        if (sub === "/automation") return [200, automation()];
        if (sub.startsWith("/dashboard")) return [200, dashboard()];
        if (sub === "/requests" && method === "GET") {
            const tab = query.get("state");
            let rows = requests;
            const closed = (r) => r.state === "resolved" || r.state === "cancelled";
            if (!tab || tab === "open") rows = rows.filter((r) => !closed(r));
            else rows = rows.filter((r) => r.state === tab);
            if (query.get("new_reply")) rows = rows.filter((r) => r.new_reply);
            rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            return [200, { requests: rows.map(summary), next_cursor: null }];
        }
        const rm = sub.match(/^\/requests\/([^/]+)(\/.*)?$/);
        if (rm) {
            const tail = rm[2] || "";
            const bw = rm[1] === BW_ID;
            if (tail === "" && method === "GET") return [200, detail(bw ? brightwater : acme)];
            if (tail.startsWith("/messages")) return [200, bw ? [] : messages];
            if (tail.startsWith("/events")) return [200, bw ? bwEvents : events];
            if (tail === "/documents") return [200, bw ? bwDocuments : documents];
            if (tail === "/reply-seen") { acme.new_reply = false; acme.unread_replies = 0; return [200, { ok: true }]; }
            if (method === "POST") return [200, { request_id: ACME_ID, applied_version: acme.version, message_id: null, replayed: false }];
        }
    }
    if (p === "/playbooks") return [200, [
        { id: "pb-nda", name: "NDA playbook", description: "Our positions on mutual and one-way NDAs", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" },
        { id: "pb-dpa", name: "DPA playbook", description: "Data processing terms", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" },
    ]];
    const dm = p.match(/^\/single-documents\/(doc-acme-nda|doc-bw-dpa)(\/.*)?$/);
    if (dm) {
        const t = dm[2] || "";
        const dpa = dm[1] === "doc-bw-dpa";
        const name = dpa ? "Brightwater_DPA.docx" : "Acme_NDA.docx";
        const doc = {
            id: dm[1], user_id: PRIYA.user_id, project_id: null, filename: name, file_type: "docx",
            storage_path: "x", pdf_storage_path: null, size_bytes: dpa ? 71268 : 52416, page_count: dpa ? 7 : 4, structure_tree: null, status: "ready",
            created_at: dpa ? "2026-11-09T09:42:01Z" : "2026-11-09T10:14:02Z", updated_at: dpa ? "2026-11-09T10:19:40Z" : "2026-11-09T10:15:20Z",
            current_version_id: "v2", active_version_number: 2, latest_version_number: 2, can_edit: true, can_delete: false,
            owner_display_name: dpa ? "Maya Chen" : "Jordan Lee",
        };
        if (t === "") return [200, doc];
        if (t === "/versions") return [200, { current_version_id: "v2", versions: [
            { id: "v2", version_number: 2, source: "assistant_edit", created_at: dpa ? "2026-11-09T10:19:40Z" : "2026-11-09T10:15:20Z", filename: name, file_type: "docx", size_bytes: dpa ? 71268 : 52416, page_count: dpa ? 7 : 4 },
            { id: "v1", version_number: 1, source: "upload", created_at: dpa ? "2026-11-09T09:42:01Z" : "2026-11-09T10:14:02Z", filename: name, file_type: "docx", size_bytes: dpa ? 70112 : 49870, page_count: dpa ? 7 : 4 },
        ] }];
        if (t.startsWith("/file")) return [200, require("fs").readFileSync(require("path").join(__dirname, "docx", name)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
        if (t.startsWith("/url")) return [200, { url: "/api/single-documents/doc-acme-nda/file" }];
        if (t.startsWith("/edits")) return [200, []];
    }
    if (p === "/models/configured" || p === "/models/ollama") return [200, { models: [] }];
    if (p === `/orgs/${ORG}/api-keys`) return [200, {
        keys: { claude: true }, effective: { claude: true }, router_models: {}, effective_router_models: {},
        allow_personal_api_keys: true, can_manage: true,
    }];
    if (p === "/chat/chat-bw-dpa") return [200, { chat: BW_CHAT, is_owner: true, access_role: "owner", messages: BW_MESSAGES }];
    if (p === "/projects") return [200, [
        { id: "p1", name: "Acme commercial", user_id: PRIYA.user_id, access_role: "owner", org_id: ORG, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-11-06T10:00:00Z", documents: [] },
        { id: "p2", name: "Brightwater onboarding", user_id: PRIYA.user_id, access_role: "owner", org_id: ORG, created_at: "2026-10-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z", documents: [] },
        { id: "p3", name: "Q4 vendor renewals", user_id: SAM.user_id, access_role: "editor", org_id: ORG, created_at: "2026-10-05T10:00:00Z", updated_at: "2026-11-04T10:00:00Z", documents: [] },
    ]];
    if (p === "/chat") return [200, [
        { id: "c1", title: "Residuals clauses: market practice", user_id: PRIYA.user_id, project_id: null, created_at: "2026-11-06T15:00:00Z", updated_at: "2026-11-06T15:00:00Z", is_owner: true, access_role: "owner" },
        { id: "c2", title: "Brightwater DPA: SCCs check", user_id: PRIYA.user_id, project_id: null, created_at: "2026-11-05T11:00:00Z", updated_at: "2026-11-05T11:00:00Z", is_owner: true, access_role: "owner" },
        { id: "c3", title: "Summarise Harbor & Pine renewal", user_id: PRIYA.user_id, project_id: null, created_at: "2026-11-04T09:00:00Z", updated_at: "2026-11-04T09:00:00Z", is_owner: true, access_role: "owner" },
    ]];
    unknown.add(`${method} ${p}`);
    return null;
}

module.exports = { handle, steps, queueNewRequestToast, unknown, ACME_ID, BW_ID, ORG, NOW };
