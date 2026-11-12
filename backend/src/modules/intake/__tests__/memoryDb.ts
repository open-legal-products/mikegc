import { randomUUID } from "node:crypto";
import type { Db } from "../../../lib/supabase";

/**
 * An in-memory stand-in for the PostgREST query builder: enough of select,
 * insert, upsert, update, delete and their filters for the automated intake
 * services, holding real rows so a test can follow a message from webhook to
 * request. Unique keys are enforced as Postgres would (23505). RPCs go to the
 * handlers a test supplies.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
type RpcHandler = (args: Record<string, unknown>, db: MemoryDb) => Result | Promise<Result>;

export type MemoryDb = {
  db: Db;
  tables: Record<string, Row[]>;
  rows: (table: string) => Row[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  /** Return an error to fail a write, as a database outage would. */
  intercept?: (write: { table: string; op: string; values: unknown }) => unknown;
};

const UNIQUE: Record<string, string[][]> = {
  intake_inbound: [["id"], ["org_id", "source", "external_id"]],
  intake_automation: [["org_id"], ["slack_webhook_id"], ["email_webhook_id"], ["teams_webhook_id"]],
  intake_assignment_rules: [["id"]],
  documents: [["id"]],
  intake_requests: [["id"]],
  intake_channel_links: [["id"], ["request_id"], ["org_id", "source", "thread_key"]],
  intake_outbound: [["id"]],
  intake_messages: [["id"]],
  intake_email_message_ids: [["org_id", "message_id"]],
};

const DEFAULTS: Record<string, () => Row> = {
  intake_inbound: () => ({
    id: randomUUID(),
    kind: "request",
    status: "pending",
    payload: null,
    request_id: null,
    error: null,
    created_at: new Date().toISOString(),
  }),
  intake_automation: () => ({
    email_enabled: false,
    email_allowed_domains: [],
    email_provider: null,
    email_mailbox: null,
    email_from_name: "Legal",
    email_webhook_id: randomUUID(),
    email_last_read_at: null,
    email_error: null,
    graph_tenant_id: null,
    graph_client_id: null,
    graph_client_secret_encrypted: null,
    graph_client_secret_iv: null,
    graph_client_secret_tag: null,
    graph_subscription_id: null,
    graph_subscription_expires_at: null,
    graph_client_state_hash: null,
    graph_delta_link: null,
    gmail_history_id: null,
    gmail_service_account_key_encrypted: null,
    gmail_service_account_key_iv: null,
    gmail_service_account_key_tag: null,
    gmail_service_account_id: null,
    slack_scopes: null,
    slack_messages_seen_at: null,
    teams_enabled: false,
    teams_webhook_id: randomUUID(),
    teams_app_id: null,
    teams_tenant_id: null,
    teams_client_secret_encrypted: null,
    teams_client_secret_iv: null,
    teams_client_secret_tag: null,
    teams_files_access: null,
    slack_enabled: false,
    slack_webhook_id: randomUUID(),
    slack_team_id: null,
    slack_team_name: null,
    slack_bot_user_id: null,
    slack_signing_secret_encrypted: null,
    slack_signing_secret_iv: null,
    slack_signing_secret_tag: null,
    slack_bot_token_encrypted: null,
    slack_bot_token_iv: null,
    slack_bot_token_tag: null,
    triage_model: null,
    preprocessing_model: null,
    configured_by: null,
  }),
  documents: () => ({ id: randomUUID() }),
  intake_channel_links: () => ({ id: randomUUID(), address: {}, created_at: new Date().toISOString() }),
  intake_messages: () => ({ created_at: new Date().toISOString() }),
  intake_email_message_ids: () => ({ created_at: new Date().toISOString() }),
};

const copy = <T,>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

export function memoryDb(
  seed: Record<string, Row[]> = {},
  rpc: Record<string, RpcHandler> = {},
): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed))
    tables[name] = rows.map((r) => ({ ...(DEFAULTS[name]?.() ?? {}), ...copy(r) }));
  const table = (name: string) => (tables[name] ??= []);
  const conflict = (name: string, row: Row, except?: Row) =>
    (UNIQUE[name] ?? []).some((cols) =>
      table(name).some(
        (other) =>
          other !== except &&
          cols.every((c) => row[c] !== null && row[c] !== undefined && other[c] === row[c]),
      ),
    );
  const memory: MemoryDb = {
    db: undefined as unknown as Db,
    tables,
    rows: (name) => table(name),
    rpcCalls: [],
  };

  const from = (name: string) => {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let values: unknown;
    let options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let returning = false;
    const filters: ((row: Row) => boolean)[] = [];
    let order: [string, boolean] | null = null;
    let limit: number | null = null;
    let columns: string[] | null = null;
    // Only the selected columns come back, as from PostgREST; embedded
    // resources such as organizations!inner(id) are not modelled.
    const project = (rows: Row[]) =>
      columns
        ? rows.map((r) => Object.fromEntries(columns!.map((c) => [c, r[c] ?? null])))
        : rows;

    const run = (): Result => {
      if (op !== "select") {
        const error = memory.intercept?.({ table: name, op, values: copy(values) });
        if (error) return { data: null, error };
      }
      const matches = () => table(name).filter((r) => filters.every((f) => f(r)));
      if (op === "select") {
        let rows = matches();
        if (order) {
          const [col, asc] = order;
          rows = [...rows].sort((a, b) =>
            String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0,
          );
        }
        if (limit !== null) rows = rows.slice(0, limit);
        return { data: copy(project(rows)), error: null };
      }
      if (op === "insert" || op === "upsert") {
        const input = (Array.isArray(values) ? values : [values]) as Row[];
        const written: Row[] = [];
        for (const raw of input) {
          const row = { ...(DEFAULTS[name]?.() ?? {}), ...copy(raw) };
          if (op === "upsert") {
            const keys = (options.onConflict ?? "id").split(",");
            const existing = table(name).find((r) => keys.every((k) => r[k] === raw[k]));
            if (existing) {
              if (!options.ignoreDuplicates) {
                Object.assign(existing, copy(raw));
                written.push(existing);
              }
              continue;
            }
          }
          if (conflict(name, row))
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          table(name).push(row);
          written.push(row);
        }
        return { data: returning ? copy(project(written)) : null, error: null };
      }
      if (op === "update") {
        const rows = matches();
        for (const row of rows) Object.assign(row, copy(values as Row));
        return { data: returning ? copy(project(rows)) : null, error: null };
      }
      const doomed = new Set(matches());
      tables[name] = table(name).filter((r) => !doomed.has(r));
      return { data: returning ? copy([...doomed]) : null, error: null };
    };

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: (list?: string) => {
        if (op !== "select") returning = true;
        if (list && list.trim() !== "*")
          columns = list
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c && !/[(!]/.test(c));
        return builder;
      },
      insert: (v: unknown) => ((op = "insert"), (values = v), builder),
      upsert: (v: unknown, o: typeof options = {}) => (
        (op = "upsert"), (values = v), (options = o), builder
      ),
      update: (v: unknown) => ((op = "update"), (values = v), builder),
      delete: () => ((op = "delete"), builder),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), builder),
      // Timestamps are ISO strings here, which compare in time order.
      lt: (c: string, v: unknown) => (
        filters.push((r) => r[c] !== null && r[c] !== undefined && String(r[c]) < String(v)), builder
      ),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), builder),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), builder),
      not: (c: string, operator: string, v: unknown) => {
        if (operator === "is") filters.push((r) => (r[c] ?? null) !== v);
        if (operator === "in") {
          const list = String(v).replace(/^\(|\)$/g, "").split(",").filter(Boolean);
          filters.push((r) => !list.includes(String(r[c])));
        }
        return builder;
      },
      order: (c: string, o?: { ascending?: boolean }) => (
        (order = [c, o?.ascending !== false]), builder
      ),
      limit: (n: number) => ((limit = n), builder),
      single: async () => {
        const result = run();
        if (result.error) return result;
        const rows = (Array.isArray(result.data) ? result.data : []) as Row[];
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "not one row" } };
      },
      maybeSingle: async () => {
        const result = run();
        if (result.error) return result;
        const rows = (Array.isArray(result.data) ? result.data : []) as Row[];
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    });
    return builder;
  };

  memory.db = {
    from,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      memory.rpcCalls.push({ name, args: copy(args) });
      const handler = rpc[name];
      if (!handler) return { data: null, error: { code: "42883", message: "missing" } };
      return handler(args, memory);
    },
  } as unknown as Db;
  return memory;
}

/** intake_replace_rules as the migration defines it: the rules become those given, in order. */
export const intakeRulesRpc: Record<string, RpcHandler> = {
  intake_replace_rules: (args, memory) => {
    if (!memory.rows("intake_automation").some((r) => r.org_id === args.p_org))
      return { data: null, error: { code: "P0002" } };
    const rules = args.p_rules as Row[];
    memory.tables.intake_assignment_rules = [
      ...memory.rows("intake_assignment_rules").filter((r) => r.org_id !== args.p_org),
      ...rules.map((r, position) => ({ id: `rule-${position}`, org_id: args.p_org, position, ...r })),
    ];
    return { data: null, error: null };
  },
};

/**
 * The automated-intake SQL functions as the migration defines them, enough
 * for unit tests: one request per message, documents linked once.
 */
export const automatedIntakeRpc: Record<string, RpcHandler> = {
  intake_submit_automated: (args, memory) => {
    const inbound = memory
      .rows("intake_inbound")
      .find((r) => r.id === args.p_inbound && r.org_id === args.p_org);
    if (!inbound) return { data: null, error: { code: "P0002" } };
    if (inbound.request_id) return { data: inbound.request_id, error: null };
    if (inbound.status !== "pending") return { data: null, error: { code: "P0001" } };
    const member = memory
      .rows("org_members")
      .some((m) => m.org_id === args.p_org && m.user_id === args.p_assignee);
    const assignee = member ? args.p_assignee : null;
    memory.rows("intake_requests").push({
      id: args.p_request,
      org_id: args.p_org,
      created_by: null,
      source: inbound.source,
      subject: args.p_subject,
      description: args.p_description,
      requester_name: args.p_requester_name,
      requester_email: args.p_requester_email ?? null,
      requested_by_date: args.p_date ?? null,
      assignee_id: assignee,
      state: assignee ? "in_review" : "submitted",
    });
    inbound.request_id = args.p_request;
    return { data: args.p_request, error: null };
  },
  intake_attach_automated: (args, memory) => {
    const document = memory
      .rows("documents")
      .find((d) => d.id === args.p_document && d.org_id === args.p_org && d.user_id === null);
    const request = memory.rows("intake_requests").find((r) => r.id === args.p_request);
    if (!document || !request) return { data: null, error: { code: "P0002" } };
    const links = memory.rows("intake_request_documents");
    if (!links.some((l) => l.document_id === args.p_document))
      links.push({
        org_id: args.p_org,
        request_id: args.p_request,
        document_id: args.p_document,
        added_by: null,
        automated: true,
        message_id: args.p_message ?? null,
      });
    return { data: null, error: null };
  },
  ...requesterLoopRpc(),
  intake_note_automated: (args, memory) => {
    const request = memory
      .rows("intake_requests")
      .find((r) => r.id === args.p_request && r.org_id === args.p_org);
    if (!request) return { data: null, error: { code: "P0002" } };
    const notes = memory.rows("intake_messages");
    if (notes.some((n) => n.id === args.p_note)) return { data: false, error: null };
    notes.push({
      id: args.p_note,
      org_id: args.p_org,
      request_id: args.p_request,
      author_id: null,
      kind: "note",
      body: args.p_body,
      automated: true,
      purpose: args.p_purpose ?? null,
    });
    return { data: true, error: null };
  },
};

const MAX_ROUNDS = 2;
const findRequest = (memory: MemoryDb, org: unknown, id: unknown) =>
  memory.rows("intake_requests").find((r) => r.org_id === org && r.id === id);
const linkOf = (memory: MemoryDb, request: unknown) =>
  memory.rows("intake_channel_links").find((l) => l.request_id === request);
const event = (memory: MemoryDb, row: Row) => memory.rows("intake_events").push(row);

/**
 * The requester loop's SQL functions as the migration defines them, enough
 * for unit tests: links, MikeGC's questions and acknowledgement, replies,
 * settling a stage and recording deliveries.
 */
export function requesterLoopRpc(): Record<string, RpcHandler> {
  return {
    intake_link_thread: (args, memory) => {
      if (!findRequest(memory, args.p_org, args.p_request)) return { data: null, error: { code: "P0002" } };
      const own = linkOf(memory, args.p_request);
      if (own) return { data: own.id, error: null };
      const taken = memory
        .rows("intake_channel_links")
        .some((l) => l.org_id === args.p_org && l.source === args.p_source && l.thread_key === args.p_thread_key);
      if (taken) return { data: null, error: null };
      const id = randomUUID();
      memory.rows("intake_channel_links").push({
        id,
        org_id: args.p_org,
        request_id: args.p_request,
        source: args.p_source,
        thread_key: args.p_thread_key,
        address: copy(args.p_address ?? {}),
      });
      return { data: id, error: null };
    },
    intake_acknowledge_automated: (args, memory) => {
      const link = linkOf(memory, args.p_request);
      if (!link) return { data: null, error: null };
      const existing = memory
        .rows("intake_outbound")
        .find((o) => o.request_id === args.p_request && o.kind === "acknowledgement");
      if (existing) return { data: existing.status === "pending" ? existing.id : null, error: null };
      memory.rows("intake_outbound").push({
        id: args.p_outbound,
        org_id: args.p_org,
        request_id: args.p_request,
        link_id: link.id,
        message_id: null,
        author_id: null,
        kind: "acknowledgement",
        documents: [],
        status: "pending",
        external_id: null,
        attempted_at: null,
      });
      return { data: args.p_outbound, error: null };
    },
    intake_answer_automated: (args, memory) => {
      const request = findRequest(memory, args.p_org, args.p_request);
      if (!request) return { data: null, error: { code: "P0002" } };
      if (memory.rows("intake_messages").some((m) => m.id === args.p_message)) return { data: true, error: null };
      const link = linkOf(memory, args.p_request);
      if (!link || ["resolved", "cancelled"].includes(String(request.state))) return { data: false, error: null };
      memory.rows("intake_messages").push({
        id: args.p_message,
        org_id: args.p_org,
        request_id: args.p_request,
        author_id: null,
        kind: "answer",
        body: args.p_body,
        automated: true,
        created_at: new Date().toISOString(),
      });
      memory.rows("intake_outbound").push({
        id: args.p_outbound,
        org_id: args.p_org,
        request_id: args.p_request,
        link_id: link.id,
        message_id: args.p_message,
        author_id: null,
        kind: "answer",
        documents: [],
        status: "pending",
        external_id: null,
        attempted_at: null,
      });
      return { data: true, error: null };
    },
    intake_ask_automated: (args, memory) => {
      const request = findRequest(memory, args.p_org, args.p_request);
      if (!request) return { data: null, error: { code: "P0002" } };
      if (memory.rows("intake_messages").some((m) => m.id === args.p_message)) return { data: true, error: null };
      const link = linkOf(memory, args.p_request);
      const rounds = Number(request.clarify_rounds ?? 0);
      if (!link || request.clarify_stopped || rounds >= MAX_ROUNDS || ["resolved", "cancelled"].includes(String(request.state)))
        return { data: false, error: null };
      const acknowledged = memory
        .rows("intake_outbound")
        .some((o) => o.request_id === args.p_request && o.kind === "acknowledgement");
      memory.rows("intake_messages").push({
        id: args.p_message,
        org_id: args.p_org,
        request_id: args.p_request,
        author_id: null,
        kind: "question",
        body: args.p_body,
        automated: true,
        created_at: new Date().toISOString(),
      });
      memory.rows("intake_outbound").push({
        id: args.p_outbound,
        org_id: args.p_org,
        request_id: args.p_request,
        link_id: link.id,
        message_id: args.p_message,
        author_id: null,
        kind: args.p_acknowledge && !acknowledged ? "acknowledgement" : "question",
        documents: [],
        status: "pending",
        external_id: null,
        attempted_at: null,
      });
      if (request.state !== "needs_information")
        event(memory, { request_id: request.id, kind: "wait", automated: true, from_state: request.state, to_state: "needs_information" });
      Object.assign(request, {
        clarify_stage: args.p_stage,
        clarify_rounds: rounds + 1,
        clarify_preprocess: args.p_preprocess ?? request.clarify_preprocess ?? null,
        state: "needs_information",
      });
      return { data: true, error: null };
    },
    intake_settle_clarify_automated: (args, memory) => {
      const request = findRequest(memory, args.p_org, args.p_request);
      if (!request) return { data: null, error: { code: "P0002" } };
      if ((request.clarify_stage ?? null) !== args.p_stage) return { data: false, error: null };
      const member = memory
        .rows("org_members")
        .some((m) => m.org_id === args.p_org && m.user_id === args.p_assignee);
      const assignee = args.p_assign && args.p_assignee && member ? args.p_assignee : request.assignee_id ?? null;
      const state =
        request.state === "needs_information" ? (assignee ? "in_review" : "submitted") : request.state;
      if (assignee !== (request.assignee_id ?? null))
        event(memory, { request_id: request.id, kind: "assign", automated: true, assignee_id: assignee, to_state: state });
      Object.assign(request, { clarify_stage: null, assignee_id: assignee, state });
      return { data: true, error: null };
    },
    intake_reply_automated: (args, memory) => {
      const inbound = memory.rows("intake_inbound").find((i) => i.id === args.p_inbound && i.org_id === args.p_org);
      if (!inbound || inbound.kind !== "reply") return { data: null, error: { code: "P0002" } };
      const request = findRequest(memory, args.p_org, inbound.request_id);
      if (!request) return { data: null, error: null };
      if (!memory.rows("intake_messages").some((m) => m.id === args.p_message)) {
        memory.rows("intake_messages").push({
          id: args.p_message,
          org_id: args.p_org,
          request_id: request.id,
          author_id: null,
          kind: "reply",
          body: args.p_body,
          external_author: copy(args.p_author),
          automated: false,
          created_at: new Date().toISOString(),
        });
        if (request.state === "needs_information" && !request.clarify_stage)
          request.state = request.assignee_id ? "in_review" : "submitted";
        request.last_reply_at = new Date().toISOString();
      }
      return {
        data: {
          request_id: request.id,
          message_id: args.p_message,
          state: request.state,
          assignee_id: request.assignee_id ?? null,
          clarify_stage: request.clarify_stage ?? null,
          clarify_rounds: request.clarify_rounds ?? 0,
          clarify_stopped: request.clarify_stopped ?? false,
          clarify_preprocess: request.clarify_preprocess ?? null,
        },
        error: null,
      };
    },
    intake_update_automated: (args, memory) => {
      const request = findRequest(memory, args.p_org, args.p_request);
      if (!request) return { data: null, error: { code: "P0002" } };
      if (memory.rows("intake_messages").some((m) => m.id === args.p_note)) return { data: [], error: null };
      if (["resolved", "cancelled"].includes(String(request.state))) return { data: [], error: null };
      const locked = (request.member_edited_fields as string[] | undefined) ?? [];
      const values: Record<string, unknown> = {
        subject: args.p_subject,
        description: args.p_description,
        requested_by_date: args.p_date,
      };
      const applied = Object.keys(values).filter(
        (field) => values[field] != null && values[field] !== request[field] && !locked.includes(field),
      );
      if (!applied.length) return { data: [], error: null };
      const lines = applied
        .map((field) => (args.p_lines as Record<string, string>)[field])
        .filter((said): said is string => !!said?.trim());
      const said =
        lines.length === 0
          ? "the details"
          : lines.length === 1
            ? lines[0]
            : lines.length === 2
              ? `${lines[0]} and ${lines[1]}`
              : `${lines[0]}, ${lines[1]} and ${lines[2]}`;
      for (const field of applied) request[field] = values[field];
      memory.rows("intake_messages").push({
        id: args.p_note,
        org_id: args.p_org,
        request_id: request.id,
        author_id: null,
        kind: "note",
        body: `Updated ${said} from the requester's reply.`,
        automated: true,
        created_at: new Date().toISOString(),
      });
      return { data: applied, error: null };
    },
    intake_record_delivery: (args, memory) => {
      const row = memory.rows("intake_outbound").find((o) => o.id === args.p_outbound && o.org_id === args.p_org);
      if (!row) return { data: false, error: null };
      Object.assign(row, {
        status: args.p_status,
        external_id: args.p_external_id ?? row.external_id ?? null,
        error: args.p_status === "failed" ? args.p_error : null,
        documents: args.p_documents ?? row.documents,
        attempted_at: row.attempted_at ?? new Date().toISOString(),
        ...(args.p_status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      });
      return { data: true, error: null };
    },
  };
}
