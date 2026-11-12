// Authored wire contracts. No server, browser, UI or storage dependencies.

export type TabularReviewHistoryStatus = {
  id: string;
  is_running: boolean;
  is_complete: boolean;
};

export type SourceDocumentType =
  | "docx"
  | "pdf"
  | "spreadsheet"
  | "case"
  | "legislation";

export type SourceDocumentMetadata = {
  label: string;
  value: string;
  format?: "date";
};

export type SourceDocumentAction = {
  type: "download" | "link";
  url: string;
  label: string;
  title?: string;
};

export type SourceDocumentQuote = {
  quote: string;
  verification?: {
    verified: boolean;
    source_excerpt?: string;
    start_char?: number;
    end_char?: number;
  };
  target: {
    page?: number | string;
    sheet?: string;
    cell?: string;
    subdocument_id?: string;
  };
};

export type SourceSubdocument = {
  document_id: string;
  title: string;
  type: "html";
  html?: string | null;
  text?: string | null;
};

export type SourceDocument = {
  document_id: string;
  title: string;
  type: SourceDocumentType;
  metadata: SourceDocumentMetadata[];
  actions?: SourceDocumentAction[];
  quotes: SourceDocumentQuote[];
  subdocuments?: SourceSubdocument[];
  version_id?: string | null;
  version_number?: number | null;
};

/**
 * Per-quote verification result. `start_char`/`end_char` index into the
 * EXTRACTED source text (not the raw file bytes) and are only present for
 * single-segment quotes that matched.
 */
export type QuoteVerification = {
  verified: boolean;
  start_char?: number;
  end_char?: number;
  source_excerpt?: string;
};

// ---------------------------------------------------------------------------
// Event / annotation types (shared between toolDispatcher and streaming)
// ---------------------------------------------------------------------------

export type AskInputOption = {
  value: string;
};

export type AskInputItem =
  | {
      id: string;
      kind: "choice";
      question: string;
      options: AskInputOption[];
      allow_other: boolean;
      other_label: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "multi_choice";
      question: string;
      options: AskInputOption[];
      allow_other: boolean;
      other_label: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "text";
      question: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "documents";
      document_types: string[];
      response_prefix?: string;
    }
  | ConnectorApprovalItem;

/**
 * A connector write the server paused for the user's approval. The server
 * creates these items, never the model's ask_inputs tool, and on approval it
 * runs the stored `action` from the persisted event — the client supplies
 * only the decision.
 */
export type ConnectorApprovalItem = {
  id: string;
  kind: "approval";
  connector_name: string;
  /** Tool name as the model called it. */
  tool_name: string;
  /** Human-readable action label, e.g. "Send email". */
  title: string;
  /** Arguments that run on approval, shown for review. */
  arguments: Record<string, unknown>;
  /** Current state the action changes, when the connector can read it. */
  before?: unknown;
  /** Account the action runs as, when known. */
  account?: string;
  /** Title of the delegated task that asked for this action, if a subagent did. */
  requested_by?: string;
  /** Server-side binding to the connection that was reviewed. */
  binding: ConnectorApprovalBinding;
};

export type ConnectorApprovalBinding =
  | {
      type: "mcp";
      connector_id: string;
      tool_id: string;
      /** Absent on legacy approvals, which must be reviewed again. */
      connection_fingerprint?: string;
    }
  | {
      type: "google";
      provider: GoogleWorkspaceProvider | "google-drive";
      grant_id: string;
      etag?: string;
    };

export type AskInputsEvent = {
  type: "ask_inputs";
  /** Stable identity for this particular prompt within its assistant message. */
  event_id: string;
  items: AskInputItem[];
};

export type AskInputResponseItem =
  | {
      id: string;
      kind: "choice";
      question: string;
      answer?: string;
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "multi_choice";
      question: string;
      answers?: string[];
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "text";
      question: string;
      answer?: string;
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "documents";
      filenames: string[];
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "approval";
      decision: "approve" | "reject";
    };

export type AskInputsResponseRequest = {
  /** Durable assistant row that contains the unanswered ask_inputs event. */
  assistant_message_id: string;
  /** The exact ask_inputs event being answered. */
  ask_event_id: string;
  responses: AskInputResponseItem[];
};

export type EditAnnotation = {
  kind: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before: string;
  context_after: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
};

export type CourtlistenerToolEvent =
  | {
      type: "courtlistener_search_case_law";
      query: string;
      result_count: number;
      error?: string;
    }
  | {
      type: "courtlistener_get_cases";
      cluster_ids: number[];
      case_count: number;
      opinion_count: number;
      cases?: {
        cluster_id: number;
        case_name: string | null;
        citation: string | null;
        dateFiled?: string | null;
        url?: string | null;
      }[];
      error?: string;
    }
  | {
      type: "courtlistener_find_in_case";
      cluster_id: number | null;
      query: string;
      total_matches: number;
      case_name?: string | null;
      citation?: string | null;
      searches?: {
        cluster_id: number | null;
        query: string;
        total_matches: number;
        case_name?: string | null;
        citation?: string | null;
        error?: string;
      }[];
      error?: string;
    }
  | {
      type: "courtlistener_read_case";
      cluster_id: number | null;
      case_name?: string | null;
      citation?: string | null;
      opinion_count: number;
      error?: string;
    }
  | {
      type: "courtlistener_verify_citations";
      citation_count: number;
      match_count: number;
      error?: string;
    };

export type CaseCitationEvent = {
  type: "case_citation";
  cluster_id: number | null;
  case_name: string | null;
  citation: string | null;
  url: string;
  pdfUrl?: string | null;
  dateFiled?: string | null;
  document: SourceDocument;
};

export type McpToolEvent = {
  type: "mcp_tool_call";
  connector_id: string;
  connector_name: string;
  tool_name: string;
  /** Human-readable tool label from the connector, when it provides one. */
  tool_title?: string;
  openai_tool_name: string;
  status: "ok" | "error";
  error?: string;
  /** The approval item this call ran for, when it needed the user's approval. */
  approval_id?: string;
  /** Bounded tool output replayed to the model after an approved call. */
  result?: string;
};

export type WebSource = { url: string; title?: string };

export type WebToolErrorCode =
  /** Mike's search has no key for the chosen search service. */
  | "not_configured"
  /** The search API refused the key: invalid, or its plan does not cover the request. */
  | "rejected"
  /** No search backend could run, or the model provider refused its own search. */
  | "unavailable"
  /** The page could not be read: a blocked address, an unsupported type, a failed fetch. */
  | "unreadable"
  | "failed";

/**
 * Web activity in a turn. A search done by the model provider and one done
 * by Mike's own search look the same.
 */
export type WebToolEvent =
  | {
      type: "web_search";
      search_id: string;
      query: string;
      results: WebSource[];
      error?: string;
      error_code?: WebToolErrorCode;
    }
  | {
      type: "web_read";
      read_id: string;
      url: string;
      title?: string;
      error?: string;
      error_code?: WebToolErrorCode;
    }
  /** Pages the answer cites, as reported by the model provider. */
  | { type: "web_sources"; sources: WebSource[] };

export type DelegationEffort = "quick" | "standard" | "deep";
export type DelegationModelTier = "light" | "standard" | "same";

/**
 * One delegated task: a subagent's own steps and the brief it returned to the
 * assistant. The brief keeps the subagent's citation markers; the assistant
 * re-cites anything it relies on.
 */
export type DelegationEvent = {
  type: "delegation";
  delegation_id: string;
  continued_from?: string;
  title: string;
  task: string;
  /**
   * `incomplete`: stopped by its time or token budget; the brief is partial.
   * `needs_input`: paused to ask `question` or for `approval_ids`.
   */
  status: "completed" | "incomplete" | "needs_input" | "failed" | "cancelled";
  brief?: string;
  question?: string;
  /** Approval items, held by the answer, that this paused subagent waits on. */
  approval_ids?: string[];
  events: AssistantEvent[];
  model: string;
  effort: DelegationEffort;
  /** The reasoning level the subagent ran at. Older runs did not record it. */
  reasoning?: string;
  /** The tokens its effort allowed. Older runs did not record it. */
  token_budget?: number;
  usage?: { input_tokens: number; output_tokens: number };
};

/**
 * What an answer ran on, sent once at its end: the model, the reasoning level
 * it was asked for, and the tokens the assistant itself used (each subagent
 * reports its own on its delegation event). Shown only when the user turns on
 * Settings > Features > Response details.
 */
export type ResponseDetailsEvent = {
  type: "response_details";
  model: string;
  reasoning?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

export type DocumentSearchErrorCode =
  | "schema_out_of_date"
  | "invalid_search"
  | "search_timeout"
  | "search_unavailable"
  | "internal_error";

/** One scoped text search; counts describe this page, not every matching document. */
export type DocumentSearchEvent = {
  type: "doc_search";
  search_id: string;
  scope: string;
  query: string;
  offset: number;
  match_count?: number;
  next_offset?: number | null;
  coverage?: {
    total_versions: number;
    indexed_versions: number;
    pending_versions: number;
    failed_versions: number;
    versions_needing_ocr: number;
  };
  /** Safe, user-facing failure message. No result count is supplied on failure. */
  error?: string;
  error_code?: DocumentSearchErrorCode;
};

export type TextCardEvent = {
  type: "text_card";
  card_id: string;
  title: string;
  /** Literal, copy-ready text. Whitespace and line breaks are significant. */
  text: string;
};

/** A status change the assistant proposes for its chat's intake request. */
export type IntakeStatusChange = "resolve" | "cancel" | "wait" | "resume" | "reopen";

/**
 * A proposed status change for the intake request a chat was started from.
 * Nothing changes until the user confirms it on the card, which sends the
 * request's own command as them.
 */
export type IntakeActionEvent = {
  type: "intake_action";
  card_id: string;
  org_id: string;
  request_id: string;
  action: IntakeStatusChange;
  /** The resolution, the reason for cancelling, or a note on the change. */
  note?: string;
};

export type AssistantEvent =
  | TextCardEvent
  | IntakeActionEvent
  | DocumentSearchEvent
  | { type: "reasoning"; text: string }
  | AskInputsEvent
  | {
      type: "ask_inputs_response";
      assistant_message_id: string;
      ask_event_id: string;
      responses: AskInputResponseItem[];
      /** User who supplied this continuation, for scoped-memory attribution. */
      author_user_id?: string;
      /** Immutable evidence time used by memory wipe/enable cutoffs. */
      recorded_at?: string;
    }
  | {
      type: "doc_read";
      filename: string;
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
    }
  | {
      type: "doc_find";
      filename: string;
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
      query: string;
      total_matches: number;
    }
  | {
      type: "doc_created";
      filename: string;
      download_url: string;
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
    }
  | { type: "doc_download"; filename: string; download_url: string }
  | {
      type: "doc_replicated";
      /** Source document being copied. */
      filename: string;
      count: number;
      copies: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
    }
  | { type: "workflow_applied"; workflow_id: string; title: string }
  | {
      type: "doc_edited";
      filename: string;
      document_id: string;
      version_id: string;
      /** Per-document monotonic Vn; null if backend couldn't determine it. */
      version_number: number | null;
      download_url: string;
      annotations: EditAnnotation[];
    }
  | CaseCitationEvent
  | CourtlistenerToolEvent
  | McpToolEvent
  | WebToolEvent
  | DelegationEvent
  | ResponseDetailsEvent
  | {
      type: "case_opinions";
      cluster_id: number;
      document: SourceDocument;
    }
  | { type: "content"; text: string }
  | {
      /**
       * Placement marker for one edit a client tool proposed, spliced into
       * the event stream exactly where the tool call landed between content
       * blocks. `persistWordDocumentEdits` upserts it into the canonical
       * `word_document_edits` row and swaps it for a `word_edit_ref` — the
       * same normalization the `<EDITS>` protocol's blocks go through, so
       * both channels produce identical persisted history.
       */
      type: "word_edit_block";
      block_index: number;
      original_text: string;
      replacement_text: string;
      formats: string[];
      occurrence: "all" | null;
      reason: string | null;
    }
  | {
      type: "error";
      message: string;
      safe_to_display?: boolean;
      /**
       * Machine-readable cause, when the client can offer a specific remedy.
       * "invalid_api_key": the provider rejected the caller's key.
       */
      code?: AssistantErrorCode;
    };

export type AssistantErrorCode = "invalid_api_key";

export type WordEditApplyMode = "direct" | "approval";

export interface WordDocumentEdit {
  id: string;
  messageId: string;
  blockIndex: number;
  originalText: string;
  replacementText: string;
  formats: string[];
  occurrence?: "all";
  reason?: string;
  applyMode: "direct" | "approval";
  applyStatus: "proposed" | "applied" | "unmanaged" | "failed";
  resolutionStatus?: WordEditResolutionStatus;
  matchedOccurrences?: number;
  appliedOccurrences?: number;
  errorCode?: string;
  errorMessage?: string;
}

export type WordEditResolutionStatus = "accepted" | "rejected";

/** Explicit Google service connections are independent of Mike sign-in. */
export type GoogleWorkspaceProvider = 'gmail' | 'google-calendar';
export interface GoogleDriveStatus {
    configured: boolean;
    schemaReady?: boolean;
    connected: boolean;
    scope: string | null;
    enabled: boolean;
    /** A Drive write scope (drive.file or legacy full drive) was granted and connection binding is available. */
    writeEnabled: boolean;
    requireWriteApproval: boolean;
    /** Disables write tools while preserving individual tool choices. */
    readOnly?: boolean;
    grantId?: string;
    /** Absent for connections made before the account was recorded. */
    accountEmail?: string;
    /**
     * Add files from Google Drive can be offered: the server has the Picker's
     * browser key and app id, and the connection (if any) holds the per-file
     * drive.file scope rather than a legacy whole-Drive one.
     */
    pickerAvailable: boolean;
    tools: NativeConnectorTool[];
    redirectUri?: string | null;
}
/** What the browser needs to open the Google Picker; never a refresh token. */
export interface GoogleDrivePickerSession {
    /** Short-lived drive.file access token. */
    accessToken: string;
    expiresAt: string;
    /** Google Cloud project number; picked files are granted to this app. */
    appId: string;
    /** Browser API key restricted to the Google Picker and Google Drive APIs. */
    developerKey: string;
}
export interface GoogleWorkspaceStatus {
    configured: boolean;
    /**
     * False when the operator switched this service off for the deployment
     * (GOOGLE_WORKSPACE_DISABLED_PROVIDERS): Discover does not offer it, new
     * connections are refused, and the assistant has none of its tools.
     */
    available: boolean;
    schemaReady: boolean;
    connected: boolean;
    /** Google granted write access; false when the user or an admin withheld it. */
    writeEnabled: boolean;
    /** Whether the assistant may use this connection at all. */
    enabled: boolean;
    /** Whether each write action waits for the user's approval in the conversation. */
    requireWriteApproval: boolean;
    /** Disables write tools while preserving individual tool choices. */
    readOnly?: boolean;
    tools: NativeConnectorTool[];
    grantId?: string;
    accountEmail?: string;
    redirectUri: string | null;
}
/** A built-in connector tool and whether the user has switched it on. */
export interface NativeConnectorTool {
    name: string;
    title: string;
    description: string;
    write: boolean;
    enabled: boolean;
}

/** Organization departure preview: only public transfer items expose titles. */
export interface OrgMemberHandover {
    sharedChats: number;
    sharedReviews: number;
    sharedDocuments: number;
    projects: { id: string; title: string }[];
    workflows: { id: string; title: string }[];
    privateProjects: number;
    privateWorkflows: number;
    chats: number;
    reviews: number;
    documents: number;
}

export type OrgPrivateContentKind = "project" | "workflow" | "chat" | "tabular_review" | "document";
export interface OrgPrivateContentItem {
    kind: OrgPrivateContentKind;
    item_id: string;
    title: string | null;
    user_id: string | null;
    display_name: string | null;
    email: string | null;
    has_access: boolean;
}
export interface OrgPrivateContentPage {
    items: OrgPrivateContentItem[];
    nextOffset: number | null;
}

/** Owner-only recovery list; these items are excluded from normal access. */
export interface OrgDepartureArchive {
    id: string;
    kind: "project" | "workflow" | "chat" | "tabular_review" | "document";
    item_id: string;
    title: string;
    archived_at: string;
    expires_at: string;
}
export interface OrgDepartureArchivePage {
    items: OrgDepartureArchive[];
    nextOffset: number | null;
}
/** An archived item as the Departed members view lists it. */
export interface OrgDepartureItem extends OrgDepartureArchive {
    /** What a project or workflow holds; absent for the other kinds. */
    contents?: { documents: number; chats: number; tabular_reviews: number };
}
/** The archived work one member left behind when they departed. */
export interface OrgDeparture {
    /** Identifies the departure for as long as any of its work is archived. */
    key: string;
    /** Null once the departed account has been deleted. */
    member: {
        user_id: string;
        display_name: string | null;
        email: string | null;
    } | null;
    departed_at: string;
    /** When the earliest of its items is permanently deleted. */
    expires_at: string;
    items: OrgDepartureItem[];
}
/** Soonest deletion first. `truncated` when there was more than is listed. */
export interface OrgDepartureList {
    departures: OrgDeparture[];
    truncated: boolean;
}
/** `unresolved` items could not be reassigned or deleted and are still archived. */
export interface OrgDepartureResolution {
    resolved: number;
    unresolved: number;
}

/** A team organization still inside its owner-only recovery period. */
export interface DeletedOrganization {
    id: string;
    name: string;
    deleted_at: string;
    purge_after: string;
}

/** An identity visible in an authorized organization's audit history. */
export interface AuditActor {
  user_id: string;
  email: string | null;
  display_name: string | null;
  profile_photo: string | null;
}

export interface AuditActorPage {
  users: AuditActor[];
  nextOffset: number | null;
}

/**
 * The Legal team's internal request tracker, always on in every team
 * organization. Every member is Legal; requesters are named business
 * contacts, not accounts. Dates are business targets, not legal deadlines.
 */
export type IntakeState = "submitted" | "in_review" | "needs_information" | "resolved" | "cancelled";
export type IntakeAction = "assignment" | "notes" | "wait" | "resume" | "resolve" | "cancel" | "reopen" | "delete" | "stop_asking";
export interface IntakeMember {
  user_id: string; display_name: string | null; email: string | null;
  /** A data URL, or null when the member has not set a photo. */
  profile_photo: string | null;
}
/** A requester the queue can be filtered by, with their most recent email. */
export interface IntakeRequester { name: string; email: string | null }
/** The editable description of a request. */
export interface IntakeDetails {
  subject: string; description: string;
  requester_name: string; requester_email: string | null; requester_team: string | null;
  /** A calendar date, overdue once it has passed where the viewer is. */
  requested_by_date: string | null;
}
/** A queue row. It omits the description, which the queue never shows. */
export interface IntakeRequestSummary extends Omit<IntakeDetails, "description"> {
  id: string; state: IntakeState; version: number;
  assignee_id: string | null; assignee_name: string | null;
  created_at: string; updated_at: string;
  /** The stage MikeGC is waiting on the requester's answer for, if any. */
  clarify_stage: IntakeClarifyStage | null;
  /** The requester replied after the request was last opened. */
  new_reply: boolean;
  /** Requester replies nobody has opened yet. */
  unread_replies?: number;
  capabilities: { assign: boolean; cancel: boolean; delete: boolean };
}
export interface IntakeRequestPage { requests: IntakeRequestSummary[]; next_cursor: string | null }
/** Where a request came from: typed by a member, or recorded by MikeGC from a channel. */
export type IntakeSource = "manual" | "slack" | "outlook" | "gmail" | "teams";
/** A channel MikeGC holds a conversation with the requester in. */
export type IntakeChannel = "slack" | "outlook" | "gmail" | "teams";
/**
 * Which question MikeGC is waiting on the requester to answer: what it needs
 * to choose a triage rule, or what the rule's playbook or workflow needs.
 */
export type IntakeClarifyStage = "rule" | "readiness";
/** The thread a request came from, where messages to the requester go. */
export interface IntakeConversation {
  source: IntakeChannel;
  /** Slack or Teams channel name, without "#", when known. */
  channel_name: string | null;
  /** Teams team name, when known. */
  team_name: string | null;
  /** A link to the thread: a Slack permalink or a Teams deep link. */
  permalink: string | null;
  /** Email: the intake mailbox replies come from, and their recipients. */
  mailbox: string | null;
  to: string[];
  cc: string[];
  /** Email: the most a message's attachments can add up to, in bytes. */
  max_attachment_bytes: number | null;
  /** False when the channel can take text only, such as a Slack app without files:write. */
  documents: boolean;
}
export interface IntakeRequest extends Omit<IntakeRequestSummary, "capabilities">, IntakeDetails {
  org_id: string;
  /**
   * Null once the creator's account is erased, and for requests MikeGC
   * recorded, whose creator reads as "MikeGC".
   */
  created_by: string | null; created_by_name: string;
  source: IntakeSource;
  /** How many of its automatic rounds of questions MikeGC has asked. */
  clarify_rounds: number;
  clarify_max_rounds: number;
  /** When the requester last replied, sent back when the request is opened. */
  last_reply_at: string | null;
  /** The request's thread, or null when it has none to send to. */
  conversation: IntakeConversation | null;
  capabilities: {
    edit: boolean; assign: boolean; note: boolean; wait: boolean;
    resume: boolean; resolve: boolean; cancel: boolean; reopen: boolean;
    /** Any member may delete a request, in any state. */
    delete: boolean;
    /** A question or the resolution can be posted in the request's thread. */
    send_to_requester: boolean;
    /** MikeGC is waiting on the requester and can be stopped. */
    stop_asking: boolean;
  };
}
/** How a message sent to the requester is going. */
export interface IntakeDelivery {
  outbound_id: string;
  kind: "acknowledgement" | "question" | "answer";
  status: "pending" | "sent" | "failed";
  /** Why it couldn't be sent, in words a member can act on. */
  error: string | null;
  sent_at: string | null;
  /**
   * The message whose text it sends: a question, or a resolution's reply.
   * Null for an acknowledgement and for documents a resolution sends alone.
   */
  message_id: string | null;
  /** The documents it carries; left_out when they couldn't be sent. */
  documents: { document_id: string; filename: string; left_out: boolean }[];
}
/** Who wrote a requester's reply, as the channel names them. */
export interface IntakeExternalAuthor {
  name: string | null;
  email: string | null;
  source: IntakeChannel;
  /** The channel's ID for the person, such as a Slack user ID. */
  user_id?: string | null;
}
/**
 * A note, resolution or cancellation reason; a question to the requester
 * (a member's, or MikeGC's when automated); or the requester's reply.
 * Legacy answer messages are shown as notes.
 */
export interface IntakeMessage {
  id: string; kind: "note" | "resolution" | "cancel_reason" | "question" | "reply" | "answer";
  body: string;
  /** Posted by MikeGC, such as its preprocessing answer; it has no author. */
  automated?: boolean;
  /** What a note of MikeGC's is: "preprocessing" for its preprocessing of the request. */
  purpose?: "preprocessing" | null;
  /** Null once the author's account is erased, and for a requester's reply. */
  author_id: string | null; author_name: string; created_at: string;
  /** A requester's reply: who wrote it, in which channel. */
  external_author?: IntakeExternalAuthor | null;
  /** A question sent to the requester: how its delivery is going. */
  delivery?: IntakeDelivery | null;
}
/**
 * What a notification reports: the history entry's kind, a member's note,
 * the requester's reply, or MikeGC's preprocessing of the request.
 */
export type IntakeNotificationChange =
  | "submitted" | "assign" | "wait" | "resume" | "resolve" | "cancel" | "reopen"
  | "stop_asking" | "edited" | "document_added" | "note" | "reply" | "preprocessing";
/**
 * News for the member a request is assigned to, shown as a toast: "new_request"
 * when the request became theirs, "update" for a change someone else, MikeGC or
 * the requester made. Several changes to one request arrive as one.
 */
export interface IntakeNotification {
  /** The request's workspace: an organization ID, or "personal". */
  workspace: string;
  workspace_name: string;
  request_id: string;
  subject: string;
  kind: "new_request" | "update";
  /** The change the toast describes: what made the request theirs, or the latest. */
  change: IntakeNotificationChange;
  /** Who made it: null for MikeGC's changes and a person whose account is gone. */
  actor_name: string | null;
  /** Made by MikeGC. */
  automated: boolean;
  /** A requester's reply: the channel it came in. */
  channel: IntakeChannel | null;
  /** How many other changes there were since the member last collected. */
  more: number;
  created_at: string;
}
export interface IntakeNotificationClaim { notifications: IntakeNotification[] }
export interface IntakeEvent {
  id: number; kind: string; from_state: IntakeState | null; to_state: IntakeState | null;
  /** Null for automatic changes, such as unassignment when a member leaves. */
  actor_id: string | null; actor_name: string | null; assignee_name: string | null; created_at: string;
  /** A resolution sent to the requester: how its delivery is going. */
  delivery?: IntakeDelivery | null;
}
/**
 * Automated intake, as an organization's owners and admins see it. Secrets
 * are write-only: the response says whether they are set, never what they are.
 */
export interface IntakeAutomationSettings {
  email: {
    enabled: boolean;
    /** The intake mailbox MikeGC reads and replies from, once connected. */
    provider: IntakeMailProvider | null;
    /** The intake address, such as intake@example.com. */
    mailbox: string | null;
    /** Sender domains accepted, such as "example.com"; empty accepts no one. */
    allowed_domains: string[];
    /** The sender name on MikeGC's own emails, such as "Legal". */
    from_name: string;
    /** Microsoft 365: the Entra app MikeGC connects with; the secret is write-only. */
    graph: { tenant_id: string | null; client_id: string | null; secret_set: boolean };
    /** Where Microsoft Graph sends new-mail notifications. */
    notification_url: string;
    /** Google Workspace: the service account Gmail reads and sends with. */
    gmail: {
      /** The client ID admins add under domain-wide delegation: the organization's own account's, else the deployment's; null with neither. */
      client_id: string | null;
      /** The organization saved its own service account's JSON key (write-only). */
      key_set: boolean;
      /** The deployment has a service account to fall back on. */
      deployment_key: boolean;
    };
    /** The connection's state, for the settings page. */
    status: {
      /** When the Graph subscription runs out; it is renewed before then. */
      subscription_expires_at: string | null;
      /** When MikeGC last read the mailbox. */
      last_read_at: string | null;
      /** Why the connection isn't working, in words an admin can act on. */
      error: string | null;
    };
  };
  slack: {
    enabled: boolean;
    /** The Request URL for the Slack app's Event Subscriptions. */
    events_url: string;
    /** Whether a signing secret and bot token are saved. */
    configured: boolean;
    /** The Slack workspace and MikeGC bot the saved token belongs to. */
    team_id: string | null;
    team_name: string | null;
    bot_user_id: string | null;
    /** Scopes the requester loop needs that the bot token lacks, such as files:write. */
    missing_scopes: string[];
    /** Whether a thread message has arrived, so message events are subscribed. */
    message_events_seen: boolean;
  };
  teams: {
    enabled: boolean;
    /** The Azure Bot's messaging endpoint. */
    events_url: string;
    /** Whether the app ID, tenant ID and client secret are saved. */
    configured: boolean;
    app_id: string | null;
    tenant_id: string | null;
    /** Whether MikeGC can read and post documents through Microsoft Graph; null before it is checked. */
    files_access: boolean | null;
  };
  /** The models triage and AI preprocessing run with; neither runs without one. */
  models: {
    /** What either can be set to: every catalogued model with a key. */
    available: string[];
    /** Triage's model, or null when none is chosen. */
    triage: string | null;
    /** Whether triage's model still has a key, so triage runs. */
    triage_available: boolean;
    /** AI preprocessing's model, or null when none is chosen. */
    preprocessing: string | null;
    /** Whether preprocessing's model still has a key, so it runs. */
    preprocessing_available: boolean;
  };
  /** How triage chooses a reviewer, in the order they are tried. */
  rules: IntakeAssignmentRule[];
  /** The most recent messages received, newest first. */
  recent: IntakeInboundSummary[];
}
/** One message received for intake, without its content. */
export interface IntakeInboundSummary {
  id: string; source: Exclude<IntakeSource, "manual">;
  /** A new request, or a message in a request's thread. */
  kind: "request" | "reply";
  status: "pending" | "done" | "failed" | "ignored";
  /** Why it was ignored or failed, in words an admin can act on. */
  error: string | null;
  request_id: string | null; created_at: string;
}
/** A change to automated intake. Omitted fields keep their saved value. */
export interface IntakeAutomationUpdate {
  email_enabled?: boolean;
  email_allowed_domains?: string[];
  email_from_name?: string;
  teams_enabled?: boolean;
  teams_app_id?: string;
  teams_tenant_id?: string;
  /** Write-only. Saving it checks the app's credentials with Microsoft. */
  teams_client_secret?: string;
  /**
   * Copy the connected Outlook mailbox's Entra app (tenant ID, client ID and
   * client secret) into Teams, then check it with Microsoft as a typed one
   * is. Not sent with teams_app_id, teams_tenant_id or teams_client_secret.
   */
  teams_use_outlook_app?: true;
  slack_enabled?: boolean;
  /** Write-only. Saving a bot token checks it with Slack first. */
  slack_signing_secret?: string;
  slack_bot_token?: string;
  /** One of `models.available`, or null to stop triage. */
  triage_model?: string | null;
  /** One of `models.available`, or null to stop AI preprocessing. */
  preprocessing_model?: string | null;
  /** Replaces every rule, in this order. */
  rules?: IntakeAssignmentRule[];
}
/**
 * An assignment rule: triage assigns a request to the first rule, in order,
 * whose condition it meets, and leaves it unassigned when none does.
 */
export interface IntakeAssignmentRule {
  /** In plain words, such as "The request is about an NDA". */
  condition: string;
  assignee_id: string;
  /**
   * AI preprocessing: MikeGC answers the request in a note and marks up its
   * Word documents with tracked changes.
   */
  preprocess: boolean;
  /** The workflow or playbook preprocessing follows; null for neither. */
  preprocess_with: IntakePreprocessRule | null;
}
/** A workflow or playbook that preprocessing follows. */
export interface IntakePreprocessRule {
  kind: "workflow" | "playbook";
  id: string;
  /**
   * Its name, as whoever is reading can see it; null when they cannot open
   * it. Ignored when saving.
   */
  name?: string | null;
}
/** Which mail system the intake mailbox is on. */
export type IntakeMailProvider = "graph" | "gmail";
/** Connect the organization's intake mailbox. */
export type IntakeMailboxConnection =
  | {
      provider: "graph";
      mailbox: string;
      tenant_id: string;
      client_id: string;
      /** Write-only; may be left out to keep the saved one. */
      client_secret?: string;
      use_teams_app?: never;
    }
  | {
      provider: "graph";
      mailbox: string;
      /**
       * Connect with the Teams channel's Entra app: its tenant ID, client ID
       * and client secret are copied to the mailbox's connection.
       */
      use_teams_app: true;
      tenant_id?: never;
      client_id?: never;
      client_secret?: never;
    }
  | {
      provider: "gmail";
      mailbox: string;
      /** The service account's JSON key. Write-only; may be left out to keep the saved one, or to use the deployment's. */
      service_account_key?: string;
    };
/** A document attached to a request, readable by every organization member. */
export interface IntakeDocument {
  document_id: string; filename: string; file_type: string | null; size_bytes: number | null;
  status: string; added_by_name: string; created_at: string;
  /** The note, resolution or requester's reply the document was added with, if any. */
  message_id: string | null;
  /** Its current version is newer than the one it arrived as, such as an accepted redline. */
  revised: boolean;
}
/**
 * Where an organization's requests stand. Counts of open requests are as of
 * now; weeks start on Monday in the viewer's timezone, oldest first, and
 * a request is overdue once its target date has passed there.
 */
export type IntakeDashboardDays = 7 | 30 | 90 | 365;
export type IntakeDashboardMedianDays = 30 | 90 | 365;
export type IntakeDashboardWeeks = 4 | 8 | 12 | 26;
export interface IntakeDashboard {
  open: number; new: number; in_progress: number; waiting: number;
  unassigned: number; overdue: number;
  /** Requests created in the last `created_days`, resolved in the last `resolved_days`. */
  created: number; resolved: number;
  /** The periods these figures cover. */
  created_days: IntakeDashboardDays; resolved_days: IntakeDashboardDays;
  median_days: IntakeDashboardMedianDays;
  weeks_shown: IntakeDashboardWeeks;
  /** Median hours from creation to resolution, over the last `median_days` days. */
  median_hours_to_resolve: number | null;
  weeks: { week_start: string; created: number; resolved: number }[];
  /** Open requests per assigned member, busiest first. */
  workload: {
    assignee_id: string; name: string;
    /** The reviewer's profile photo as a data URL, or null. */
    photo: string | null;
    open: number; waiting: number; overdue: number;
  }[];
}
export interface IntakeReceipt {
  request_id: string | null; applied_version: number; message_id: string | null; replayed: boolean;
  /** The message to the requester the command wrote, if any. */
  outbound_id?: string | null;
}
export interface IntakeSubmission extends IntakeDetails { id: string; command_id: string; assignee_id: string | null }
export interface IntakeEdit extends IntakeDetails { command_id: string; expected_version: number }
/** Notes carry no version: they never change the request itself. */
export interface IntakeCommand {
  command_id: string; expected_version?: number; body?: string; assignee_id?: string | null;
  /** Wait and resolve: post the text (and resolve's documents) in the request's thread. */
  send_to_requester?: boolean;
  /** Resolve with send_to_requester: up to 10 of the request's documents to send. */
  documents?: string[];
  /** Resolve with send_to_requester: the reply sent, apart from the resolution, which stays in the app. */
  reply?: string;
}
