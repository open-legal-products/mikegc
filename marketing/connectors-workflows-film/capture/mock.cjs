// Demo workspace for the connectors and workflows film's product shots. Alia,
// its people and its counterparties are fictional (the same cast as the intake
// launch film). The state is mutable so a capture can add Linear and approve
// the Gmail action.

const fs = require("fs");
const path = require("path");

const ORG = "org-alia";
const NOW = new Date("2026-11-09T10:16:00Z"); // Mon 9 Nov 2026, London

// Profile photos: the intake film's public-domain, AI-generated faces.
const AVATARS = path.join(__dirname, "..", "..", "intake-launch-film", "capture", "avatars");
const photo = (key) => {
    const file = path.join(AVATARS, `${key}.jpg`);
    return fs.existsSync(file) ? `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` : null;
};
const PRIYA = { user_id: "u-priya", display_name: "Priya Shah", email: "priya@alia.ai", profile_photo: photo("priya") };
const SAM = { user_id: "u-sam", display_name: "Sam Ortiz", email: "sam@alia.ai", profile_photo: photo("sam") };
const DANA = { user_id: "u-dana", display_name: "Dana Kim", email: "dana@alia.ai", profile_photo: photo("dana") };
const MEMBERS = [PRIYA, SAM, DANA];

const PROFILE = {
    displayName: "Priya Shah", organisation: "Alia", jurisdiction: "California",
    practiceSetting: "in_house", professionalTitle: null, practiceAreas: ["Commercial"], profilePhoto: PRIYA.profile_photo,
    onboardingVersion: 99, onboardingComplete: true, passwordSet: true, messageCreditsUsed: 0,
    creditsResetDate: "2026-12-01", creditsRemaining: 100, tier: "pro", titleModel: null, tabularModel: null,
    memoryCuratorModel: null, subagentModel: null, subagentReasoning: null, lastSelectedChatModel: "claude-opus-5-5",
    lastSelectedReasoningLevel: "medium", mfaOnLogin: false, legalResearchUs: true, quickActionsVisible: true,
    responseDetailsVisible: false, darkMode: false, projectMemoryDefault: false, apiKeyStatus: { claude: true },
};

// ---- connectors ----------------------------------------------------------------
const CREATED = "2026-10-12T09:00:00Z";
const tool = (id, toolName, title, description, write = false) => ({
    id, toolName, openaiToolName: toolName, title, description, enabled: true,
    readOnly: !write, destructive: false, write, lastSeenAt: CREATED,
});
const SLACK = {
    id: "mcp-slack", name: "Slack", transport: "streamable_http", serverUrl: "https://mcp.slack.com/mcp",
    authType: "oauth", enabled: true, requireWriteApproval: true, readOnly: false, hasAuthConfig: true,
    customHeaderKeys: [], oauthConnected: true, toolPolicy: {}, createdAt: CREATED, updatedAt: CREATED,
    tools: [
        tool("t-s1", "slack_search_messages", "Search messages", "Search messages in channels the user can see."),
        tool("t-s2", "slack_read_thread", "Read thread", "Read a message thread."),
        tool("t-s3", "slack_send_message", "Send message", "Post a message to a channel or thread.", true),
    ],
};
const NOTION = {
    ...SLACK, id: "mcp-notion", name: "Notion", serverUrl: "https://mcp.notion.com/mcp",
    tools: [
        tool("t-n1", "notion_search", "Search", "Search pages and databases."),
        tool("t-n2", "notion_fetch", "Fetch page", "Read a page."),
        tool("t-n3", "notion_create_pages", "Create pages", "Create pages.", true),
    ],
};
const LINEAR = {
    ...SLACK, id: "mcp-linear", name: "Linear", serverUrl: "https://mcp.linear.app/mcp", createdAt: "2026-11-09T10:16:00Z",
    tools: [
        tool("t-l1", "list_issues", "List issues", "List issues."),
        tool("t-l2", "get_issue", "Get issue", "Read an issue."),
        tool("t-l3", "create_issue", "Create issue", "Create an issue.", true),
    ],
};
const withCount = (c) => ({ ...c, toolCount: c.tools.length });
let mcpConnectors = [SLACK, NOTION];

const native = (name, title, description, write = false) => ({ name, title, description, write, enabled: true });
const GMAIL_TOOLS = [
    native("gmail_search", "Search email", "Search email using Gmail query syntax (from:, subject:, after:, etc.)."),
    native("gmail_read_message", "Read email", "Read message headers, body, and attachment metadata."),
    native("gmail_read_thread", "Read email thread", "Read messages in an email thread."),
    native("gmail_list_labels", "List labels", "List mailbox label IDs and names."),
    native("gmail_list_drafts", "List drafts", "List draft IDs."),
    native("gmail_read_draft", "Read draft", "Read a draft."),
    native("gmail_send", "Send email", "Send an email from the connected account.", true),
    native("gmail_save_draft", "Save draft", "Create or update a draft.", true),
    native("gmail_delete_draft", "Delete draft", "Delete a draft.", true),
];
const CALENDAR_TOOLS = [
    native("google_calendar_list_calendars", "List calendars", "List calendars."),
    native("google_calendar_list_events", "List events", "List events."),
    native("google_calendar_read_event", "Read event", "Read an event."),
    native("google_calendar_create_event", "Create event", "Create an event.", true),
    native("google_calendar_update_event", "Update event", "Update an event.", true),
    native("google_calendar_delete_event", "Delete event", "Delete an event.", true),
];
const DRIVE_TOOLS = [
    native("google_drive_search", "Search files", "Search Google Drive by file name and full text."),
    native("google_drive_read_file", "Read file", "Read a Google Drive file's text content."),
    native("google_drive_list_recent", "List recent files", "List the most recently modified files."),
    native("google_drive_create_file", "Create file", "Create a file.", true),
    native("google_drive_copy_file", "Copy file", "Copy a file.", true),
];
const workspaceStatus = (tools) => ({
    configured: true, available: true, schemaReady: true, connected: true, writeEnabled: true, enabled: true,
    requireWriteApproval: true, readOnly: false, tools, grantId: "grant-priya", accountEmail: PRIYA.email, redirectUri: null,
});
const DRIVE = { ...workspaceStatus(DRIVE_TOOLS), scope: "https://www.googleapis.com/auth/drive.file", pickerAvailable: true };
const COURTLISTENER = { enabled: true, installed: true, ownToken: false, tokenSource: "org", bulkData: false };

// ---- the connectors chat: Drive, CourtListener and Gmail ------------------------
const MSA = "Harbor_Pine_MSA.docx";
const CONNECTOR_PROMPT = "Find the Harbor & Pine MSA in Drive and check its liability cap under California law. Then email Tom a short summary.";
const EMAIL_BODY = [
    "Hi Tom,",
    "",
    "I've reviewed Harbor & Pine's draft MSA for the renewal. Section 11.2 would cap Harbor & Pine's liability at the fees we paid in the previous three months, about $54,000, with no exceptions. California courts will generally enforce a cap like this between businesses, though it can't cover fraud, wilful injury or a violation of law.",
    "",
    "I'd ask for the cap to be raised to 12 months' fees, with data breaches and confidentiality left outside it. I'll send Harbor & Pine a markup this week.",
    "",
    "Priya",
].join("\n");
const APPROVAL = {
    id: "ap-1", kind: "approval", connector_name: "Gmail", tool_name: "gmail_send", title: "Send email",
    arguments: { to: ["tom@alia.ai"], subject: "Harbor & Pine MSA: liability cap", body: EMAIL_BODY },
    account: PRIYA.email,
    binding: { type: "google", provider: "gmail", grant_id: "grant-priya" },
};
const CONNECTOR_CHAT = {
    id: "chat-harbor-cap", title: "Harbor & Pine MSA: liability cap", user_id: PRIYA.user_id, project_id: null,
    model: "claude-opus-5-5", created_at: "2026-11-09T10:12:00Z", is_owner: true, access_role: "owner",
};
const call = (connector_name, tool_name, tool_title, extra = {}) => ({
    type: "mcp_tool_call", connector_id: connector_name === "Google Drive" ? "google-drive-native" : "gmail-native",
    connector_name, tool_name, tool_title, openai_tool_name: tool_name, status: "ok", ...extra,
});
const ANALYSIS = [
    "**Harbor_Pine_MSA.docx** (Drive, last edited 2 Nov) is Harbor & Pine's draft Master Services Agreement for renewing its data-labelling work for Alia. It's governed by California law (section 16.1).",
    "",
    "**The cap (section 11.2).** Harbor & Pine's total liability would be limited to the fees Alia paid in the **three months** before the claim, about $54,000 at $18,000 a month, and nothing sits outside the cap: not data breaches, confidentiality or its IP indemnity.",
    "",
    "**Under California law.** Courts generally enforce negotiated limitation-of-liability clauses between commercial parties. Civil Code section 1668 sets the limit: a contract can't exempt a party from liability for its own fraud, wilful injury or violation of law, so the cap wouldn't protect Harbor & Pine there. Claims for ordinary negligence would usually stay capped.",
    "",
    "**Recommendation.** Ask for 12 months' fees, with data breaches, confidentiality and the IP indemnity outside the cap.",
    "",
    "I've drafted the email to Tom below.",
].join("\n");
const connectorMessages = (approved) => [
    {
        id: "cc-m1", chat_id: CONNECTOR_CHAT.id, role: "user", content: CONNECTOR_PROMPT, created_at: "2026-11-09T10:12:00Z",
    },
    {
        id: "cc-m2", chat_id: CONNECTOR_CHAT.id, role: "assistant", created_at: "2026-11-09T10:12:04Z",
        content: [
            call("Google Drive", "google_drive_search", "Search files"),
            call("Google Drive", "google_drive_read_file", "Read file"),
            { type: "courtlistener_search_case_law", query: "limitation of liability clause enforceable California Civil Code 1668", result_count: 20 },
            { type: "courtlistener_verify_citations", citation_count: 2, match_count: 2 },
            { type: "content", text: ANALYSIS },
            { type: "ask_inputs", event_id: "ask-1", items: [APPROVAL] },
            ...(approved ? [
                { type: "ask_inputs_response", ask_event_id: "ask-1", responses: [{ id: "ap-1", kind: "approval", decision: "approve" }] },
                call("Gmail", "gmail_send", "Send email", { approval_id: "ap-1" }),
                { type: "content", text: "Sent to Tom from priya@alia.ai." },
            ] : []),
        ],
    },
];

// ---- the workflows library: open-legal-products/mikegc-workflows ----------------
// Read from a checkout of the catalog (see README); every workflow is a default,
// installed as an editable copy for each user.
const CATALOG = process.env.MIKEGC_WORKFLOWS || path.join(__dirname, "mikegc-workflows");
const ORDER = ["contract-intake", "contract-markup", "obligation-tracking", "proofread", "compare-documents",
    "extract-key-terms", "draft-from-template", "commercial-agreement-tabular-review"];
const QUICK = new Set(["contract-intake", "contract-markup", "obligation-tracking"]);
function readSkill(key) {
    const dir = ["assistant-workflows", "tabular-review-workflows"].map((d) => path.join(CATALOG, d, key)).find((d) => fs.existsSync(d));
    if (!dir) throw new Error(`workflow ${key} not found under ${CATALOG}`);
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const fm = m[1];
    const get = (k) => { const r = fm.match(new RegExp(`^\\s*${k}:\\s*"?([^"\\n]*)"?\\s*$`, "m")); return r ? r[1] : null; };
    return {
        key, title: get("mike-display-name"), description: get("description"), author: get("author"),
        version: get("version"), type: get("mike-type") === "tabular" ? "tabular" : "assistant",
        practice: get("practice"), jurisdictions: (get("jurisdictions") || "General").split(",").map((s) => s.trim()),
        body: m[2].trim(),
    };
}
let WORKFLOWS = null;
function workflows() {
    if (WORKFLOWS) return WORKFLOWS;
    WORKFLOWS = ORDER.map((key, i) => {
        const s = readSkill(key);
        return {
            id: `wf-${key}`, user_id: PRIYA.user_id, org_id: ORG, organization_name: "Alia", access_scope: "private", visibility: "private",
            metadata: {
                name: key, title: s.title, description: s.description, type: s.type,
                contributors: [{ name: s.author, organisation: null, role: null, linkedin: null }],
                language: "English", version: s.version, practice: s.practice, jurisdictions: s.jurisdictions,
            },
            skill_md: s.body, columns_config: s.type === "tabular" ? [] : null, is_system: false,
            is_default: true, default_key: key, created_at: `2026-10-0${1 + (i % 8)}T09:00:00Z`,
            allow_edit: true, is_owner: true, access_role: "owner", open_source_submission: null,
        };
    });
    return WORKFLOWS;
}
function quickActions() {
    return workflows().filter((w) => QUICK.has(w.default_key)).map((w, i) => ({
        id: `qa-${w.default_key}`, user_id: PRIYA.user_id, workflow_id: w.id, name: w.metadata.title,
        prompt: "Execute this workflow on the selected documents.", document_upload: true, surface: "app",
        enabled: true, sort_order: i, created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z",
        workflow: { id: w.id, title: w.metadata.title },
    }));
}

// ---- the quick action chat: Contract Markup on the MSA ---------------------------
const MARKUP_CHAT = {
    id: "chat-harbor-markup", title: "Contract Markup: Harbor & Pine MSA", user_id: PRIYA.user_id, project_id: null,
    model: "claude-opus-5-5", created_at: "2026-11-09T10:20:00Z", is_owner: true, access_role: "owner",
};
const MARKUP_COPY = "Harbor_Pine_MSA (Alia markup).docx";
const edit = (n, deleted_text, inserted_text, context_before, context_after, reason) => ({
    type: "edit_data", kind: "edit", edit_id: `msa-edit-${n}`, document_id: "doc-msa-markup", version_id: "mv2", version_number: 2,
    change_id: `msa-change-${n}`, deleted_text, inserted_text, context_before, context_after, reason, status: "pending",
});
const MARKUP_MESSAGES = [
    {
        id: "mk-m1", chat_id: MARKUP_CHAT.id, role: "user", content: "Execute this workflow on the selected documents.",
        files: [{ filename: MSA, document_id: "doc-msa", version_id: "mv1", version_number: 1 }],
        workflow: { id: "wf-contract-markup", title: "Contract Markup" }, created_at: "2026-11-09T10:20:00Z",
    },
    {
        id: "mk-m2", chat_id: MARKUP_CHAT.id, role: "assistant", created_at: "2026-11-09T10:20:05Z",
        content: [
            { type: "workflow_applied", workflow_id: "wf-contract-markup", title: "Contract Markup" },
            { type: "doc_read", filename: MSA, document_id: "doc-msa", version_id: "mv1", version_number: 1 },
            { type: "doc_replicated", filename: MSA, count: 1, copies: [{ new_filename: MARKUP_COPY, document_id: "doc-msa-markup", version_id: "mv1" }] },
            { type: "content", text: "This is Harbor & Pine's Master Services Agreement under California law, and Alia is the customer. With no playbook, I've taken market-standard customer positions at the Standard level and made each change as a tracked change in a copy, leaving Harbor & Pine's original untouched." },
            { type: "doc_edited", filename: MARKUP_COPY, document_id: "doc-msa-markup", version_id: "mv2", version_number: 2, download_url: "",
              annotations: [
                edit(1, "three (3) months", "twelve (12) months", "the total fees paid or payable by Customer in the ", " preceding the event giving rise to the claim", "Must-have: a cap that matches the contract's value"),
                edit(2, "", ", or to a party's breach of Section 9 (Confidentiality) or Section 10 (Data Protection and Security), or to Provider's obligations under Section 12.1 (Indemnification)", "cannot be limited or excluded under applicable law", ".", "Must-have: data, confidentiality and the IP indemnity outside the cap"),
                edit(3, "ninety (90)", "thirty (30)", "unless either party gives the other at least ", " days' written notice of non-renewal", "Important: a workable non-renewal window"),
                edit(4, "", ", provided that no increase may exceed five percent (5%) of the Fees for the preceding twelve (12) months", "at least sixty (60) days before the Renewal Term begins", ".", "Important: a cap on price increases"),
              ] },
            { type: "content", text: [
                "| Section | Change | Why | Fallback |",
                "| --- | --- | --- | --- |",
                "| 11.2 Cap | 3 months' fees → 12 months' fees | $54,000 is too low for a $648,000 three-year contract | 9 months' fees |",
                "| 11.3 Exceptions | Confidentiality, data protection and the IP indemnity sit outside the cap | A data incident could cost far more than the cap | A separate cap of 2× annual fees |",
                "| 3.2 Renewal | Non-renewal notice 90 → 30 days | Gives Finance time to review the renewal | 60 days |",
                "| 6.3 Fees | Renewal increases capped at 5% | The draft allows any increase on 60 days' notice | CPI plus 2% |",
                "",
                "**Points for business input.** Ask Tom whether Alia needs Priority Support (Schedule 2), at $2,500 a month.",
            ].join("\n") },
        ],
    },
];


// ---- the library (the quick action's document picker) ----------------------------
const libDoc = (id, filename, file_type, size, days, pages) => ({
    id, user_id: PRIYA.user_id, project_id: null, library_kind: "file", library_folder_id: null, filename, file_type,
    owner_display_name: PRIYA.display_name, owner_email: PRIYA.email, storage_path: "x", pdf_storage_path: null,
    size_bytes: size, page_count: pages, structure_tree: null, status: "ready",
    created_at: new Date(NOW.getTime() - days * 86400000).toISOString(), updated_at: new Date(NOW.getTime() - days * 86400000).toISOString(),
    current_version_id: `${id}-v1`, active_version_number: 1, latest_version_number: null,
});
const LIBRARY = [
    libDoc("doc-msa", "Harbor_Pine_MSA.docx", "docx", 83120, 0.1, 9),
    libDoc("lib-2", "Harbor_Pine_SOW_2.pdf", "pdf", 241337, 3, 9),
    libDoc("lib-3", "Brightwater_DPA.docx", "docx", 71268, 0.3, 7),
    libDoc("lib-4", "Acme_NDA.docx", "docx", 52416, 0.2, 4),
    libDoc("lib-5", "Northwind_Order_Form_2027.pdf", "pdf", 118204, 6, 3),
    libDoc("lib-6", "Office_Lease_Extension.docx", "docx", 64510, 12, 11),
];

// ---- documents -------------------------------------------------------------------
const DOCS = {
    "doc-msa": { filename: MSA, file: "Harbor_Pine_MSA.docx", versions: 1 },
    "doc-msa-markup": { filename: MARKUP_COPY, file: "Harbor_Pine_MSA_markup.docx", versions: 2 },
};

const state = { linearAdded: false, approved: false };
const steps = {
    addLinear() { if (!state.linearAdded) { state.linearAdded = true; mcpConnectors = [SLACK, NOTION, LINEAR]; } },
    approve() { state.approved = true; },
};

const unknown = new Set();

/** Answer one API call. Returns [status, body] or null when unknown. */
function handle(method, p0, query, body) {
    const p = p0.replace(/^\/api/, "");
    if (p === "/auth/session") return [200, { user: { id: PRIYA.user_id, email: PRIYA.email } }];
    if (p === "/user/profile") return [200, PROFILE];
    if (p === "/orgs") return [200, [{ id: ORG, name: "Alia", created_by: PRIYA.user_id, role: "owner", member_count: 3, logo_updated_at: null }]];
    if (p === `/orgs/${ORG}/api-keys`) return [200, {
        keys: { claude: true }, effective: { claude: true }, router_models: {}, effective_router_models: {},
        allow_personal_api_keys: true, can_manage: true,
    }];
    if (p === "/models/configured" || p === "/models/ollama") return [200, { models: [] }];
    if (p === "/intake/notifications/claim") return [200, { notifications: [] }];
    if (/^\/intake\/[^/]+\/members$/.test(p)) return [200, MEMBERS];

    // Connectors
    if (p === "/user/mcp-connectors" && method === "GET") return [200, mcpConnectors.map(withCount)];
    const mc = p.match(/^\/user\/mcp-connectors\/([^/]+)$/);
    if (mc && method === "GET") {
        const c = mcpConnectors.find((x) => x.id === mc[1]);
        return c ? [200, withCount(c)] : [404, { error: "not found" }];
    }
    if (p === "/user/integrations/google-drive") return [200, DRIVE];
    if (p === "/user/integrations/gmail") return [200, workspaceStatus(GMAIL_TOOLS)];
    if (p === "/user/integrations/google-calendar") return [200, workspaceStatus(CALENDAR_TOOLS)];
    if (p === "/user/integrations/courtlistener") return [200, COURTLISTENER];

    // Workflows
    if (p === "/workflows" && method === "GET") {
        const type = query.get("type");
        return [200, workflows().filter((w) => !type || w.metadata.type === type)];
    }
    if (p === "/workflows/ids") return [200, workflows().map((w) => ({ id: w.id, user_id: w.user_id }))];
    if (p === "/workflows/system") return [200, []];
    if (p === "/workflows/filter-options") return [200, { practices: ["General Transactions"], languages: ["English"], jurisdictions: ["General"] }];
    if (p === "/workflow-addons") return [200, []];
    const wm = p.match(/^\/workflows\/([^/]+)(\/.*)?$/);
    if (wm) {
        const w = workflows().find((x) => x.id === wm[1]);
        const t = wm[2] || "";
        if (w && t === "") return [200, w];
        if (t === "/assets") return [200, []];
        if (t === "/shares") return [200, []];
        if (t === "/people") return [200, { owner: { ...PRIYA, role: "owner" }, members: [] }];
    }
    if (p === "/quick-actions") return [200, query.get("surface") === "word" ? [] : quickActions()];

    // Chats
    if (p === `/chat/${CONNECTOR_CHAT.id}`) return [200, { chat: CONNECTOR_CHAT, is_owner: true, access_role: "owner", messages: connectorMessages(state.approved) }];
    if (p === `/chat/${MARKUP_CHAT.id}`) return [200, { chat: MARKUP_CHAT, is_owner: true, access_role: "owner", messages: MARKUP_MESSAGES }];
    if (p === "/chat") return [200, [
        { id: MARKUP_CHAT.id, title: MARKUP_CHAT.title, user_id: PRIYA.user_id, project_id: null, created_at: MARKUP_CHAT.created_at, updated_at: MARKUP_CHAT.created_at, is_owner: true, access_role: "owner" },
        { id: CONNECTOR_CHAT.id, title: CONNECTOR_CHAT.title, user_id: PRIYA.user_id, project_id: null, created_at: CONNECTOR_CHAT.created_at, updated_at: CONNECTOR_CHAT.created_at, is_owner: true, access_role: "owner" },
        { id: "c1", title: "Residuals clauses: market practice", user_id: PRIYA.user_id, project_id: null, created_at: "2026-11-06T15:00:00Z", updated_at: "2026-11-06T15:00:00Z", is_owner: true, access_role: "owner" },
        { id: "c2", title: "Brightwater DPA: SCCs check", user_id: PRIYA.user_id, project_id: null, created_at: "2026-11-05T11:00:00Z", updated_at: "2026-11-05T11:00:00Z", is_owner: true, access_role: "owner" },
    ]];
    if (p === "/projects") return [200, [
        { id: "p1", name: "Acme commercial", user_id: PRIYA.user_id, access_role: "owner", org_id: ORG, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-11-06T10:00:00Z", documents: [] },
        { id: "p2", name: "Harbor & Pine renewal", user_id: PRIYA.user_id, access_role: "owner", org_id: ORG, created_at: "2026-10-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z", documents: [] },
        { id: "p3", name: "Q4 vendor renewals", user_id: SAM.user_id, access_role: "editor", org_id: ORG, created_at: "2026-10-05T10:00:00Z", updated_at: "2026-11-04T10:00:00Z", documents: [] },
    ]];

    // Library
    const lm = p.match(/^\/library\/(files|templates)(\/.*)?$/);
    if (lm) {
        const t = lm[2] || "";
        if (t === "") return [200, { documents: lm[1] === "files" ? LIBRARY : [], folders: [], documentsHasMore: false }];
        if (t === "/ids") return [200, lm[1] === "files" ? LIBRARY.map((d) => d.id) : []];
        if (t === "/filter-options") return [200, { fileTypes: ["docx", "pdf"] }];
        if (t === "/levels") return [200, { levels: [] }];
    }

    // Documents
    const dm = p.match(/^\/single-documents\/([^/]+)(\/.*)?$/);
    if (dm && DOCS[dm[1]]) {
        const d = DOCS[dm[1]];
        const t = dm[2] || "";
        const cur = d.versions === 2 ? "mv2" : "mv1";
        const doc = {
            id: dm[1], user_id: PRIYA.user_id, project_id: null, filename: d.filename, file_type: "docx",
            storage_path: "x", pdf_storage_path: null, size_bytes: 84312, page_count: 9, structure_tree: null, status: "ready",
            created_at: "2026-11-09T10:20:03Z", updated_at: "2026-11-09T10:21:10Z",
            current_version_id: cur, active_version_number: d.versions, latest_version_number: d.versions, can_edit: true, can_delete: true,
            owner_display_name: PRIYA.display_name,
        };
        if (t === "") return [200, doc];
        if (t === "/versions") return [200, { current_version_id: cur, versions: [
            ...(d.versions === 2 ? [{ id: "mv2", version_number: 2, source: "assistant_edit", created_at: "2026-11-09T10:21:10Z", filename: d.filename, file_type: "docx", size_bytes: 84312, page_count: 9 }] : []),
            { id: "mv1", version_number: 1, source: "upload", created_at: "2026-11-09T10:20:03Z", filename: d.filename, file_type: "docx", size_bytes: 83120, page_count: 9 },
        ] }];
        if (t.startsWith("/file")) return [200, fs.readFileSync(path.join(__dirname, "docx", d.file)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
        if (t.startsWith("/url")) return [200, { url: `/api/single-documents/${dm[1]}/file` }];
        if (t.startsWith("/edits")) return [200, []];
    }
    unknown.add(`${method} ${p}`);
    return null;
}

module.exports = { handle, steps, state, unknown, ORG, NOW, CONNECTOR_CHAT, MARKUP_CHAT, PRIYA };
