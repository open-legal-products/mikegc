import type {
  IntakeDetails,
  IntakeDelivery,
  IntakeEvent,
  IntakeMember,
  IntakeRequester,
  IntakeMessage,
  IntakeReceipt,
  IntakeRequest,
  IntakeRequestPage,
  IntakeRequestSummary,
} from "@mike/contracts";
import type { Db } from "../../lib/supabase";
import { safeError } from "../../lib/safeError";
import { failure, ok, type ServiceResult } from "../../lib/serviceResult";
import { dispatchIntakeDeliverOrFail } from "./intake.deliver";
import { queueNextIntakePreprocess } from "./intake.preprocess";
import { intakeRpc } from "./intake.shared";
import type {
  IntakeCommandAction,
  IntakeCommandInput,
} from "./intake.validation";

/** The authenticated member and organization every intake call is scoped to. */
export type IntakeScope = { orgId: string; actorId: string };
const scoped = (scope: IntakeScope) => ({
  p_org: scope.orgId,
  p_actor: scope.actorId,
});
const detailArgs = (d: IntakeDetails) => ({
  p_subject: d.subject,
  p_description: d.description,
  p_requester_name: d.requester_name,
  p_requester_email: d.requester_email,
  p_requester_team: d.requester_team,
  p_date: d.requested_by_date,
});

export function listIntakeMembers(db: Db, scope: IntakeScope) {
  return intakeRpc<IntakeMember[]>(db, "intake_members", scoped(scope));
}

/** Each requester the queue can be filtered by, once. */
export function listIntakeRequesters(db: Db, scope: IntakeScope) {
  return intakeRpc<IntakeRequester[]>(
    db,
    "intake_list_requesters",
    scoped(scope),
  );
}

type Cursor = { key: string | null; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The keyset position is opaque to clients; only this module reads it. */
function encodeCursor(next: Cursor | null): string | null {
  return next
    ? Buffer.from(JSON.stringify([next.key, next.id])).toString("base64url")
    : null;
}
function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (parsed[0] === null ||
        (typeof parsed[0] === "string" && parsed[0].length <= 64)) &&
      typeof parsed[1] === "string" &&
      UUID.test(parsed[1])
    )
      return { key: parsed[0], id: parsed[1] };
  } catch {
    // Fall through: a cursor the client altered is just invalid input.
  }
  return null;
}

export async function listIntakeRequests(
  db: Db,
  scope: IntakeScope,
  filters: {
    state?: string;
    assignee?: string;
    search: string;
    sort: "updated" | "updated_asc" | "target";
    scope?: "open" | "unassigned" | "overdue" | "recorded_30d" | "resolved_30d";
    requester?: string;
    timezone: string;
    new_reply?: boolean;
    cursor?: string;
    limit: number;
  },
): Promise<ServiceResult<IntakeRequestPage>> {
  const after = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (filters.cursor && !after)
    return failure("validation", "Invalid request filters.");
  const result = await intakeRpc<{
    requests: IntakeRequestSummary[];
    next: Cursor | null;
  }>(db, "intake_list_requests", {
    ...scoped(scope),
    p_state: filters.state ?? null,
    p_assignee: filters.assignee ?? null,
    p_search: filters.search,
    p_sort: filters.sort,
    p_after_key: after?.key ?? null,
    p_after_id: after?.id ?? null,
    p_limit: filters.limit,
    p_scope: filters.scope ?? null,
    p_requester: filters.requester ?? null,
    p_timezone: filters.timezone,
    p_new_reply: filters.new_reply ?? false,
  });
  if (!result.ok) return result;
  return ok({
    requests: result.data.requests,
    next_cursor: encodeCursor(result.data.next),
  });
}

export function submitIntakeRequest(
  db: Db,
  scope: IntakeScope,
  input: IntakeDetails & {
    id: string;
    command_id: string;
    assignee_id: string | null;
  },
) {
  return intakeRpc<IntakeReceipt>(db, "intake_submit_request", {
    ...scoped(scope),
    p_command: input.command_id,
    p_request: input.id,
    ...detailArgs(input),
    p_assignee: input.assignee_id,
  });
}

export function getIntakeRequest(
  db: Db,
  scope: IntakeScope,
  requestId: string,
) {
  return intakeRpc<IntakeRequest>(db, "intake_get_request", {
    ...scoped(scope),
    p_request: requestId,
  });
}

function readHistory<T>(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  events: boolean,
  page: { offset: number; limit: number },
) {
  return intakeRpc<T[]>(db, "intake_read_history", {
    ...scoped(scope),
    p_request: requestId,
    p_events: events,
    p_offset: page.offset,
    p_limit: page.limit,
  });
}

export function listIntakeMessages(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  page: { offset: number; limit: number },
) {
  return readHistory<IntakeMessage>(db, scope, requestId, false, page);
}

export function listIntakeEvents(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  page: { offset: number; limit: number },
) {
  return readHistory<IntakeEvent>(db, scope, requestId, true, page);
}

const COMMAND_RPC: Record<IntakeCommandAction, string> = {
  assignment: "intake_assign_request",
  notes: "intake_note_request",
  wait: "intake_wait_request",
  resume: "intake_resume_request",
  resolve: "intake_resolve_request",
  cancel: "intake_cancel_request",
  reopen: "intake_reopen_request",
  delete: "intake_delete_request",
  stop_asking: "intake_stop_asking_request",
};

type CommandReceipt = IntakeReceipt & { preprocess?: boolean };

/**
 * What a committed command leaves to do outside its transaction: send the
 * message it wrote for the requester, and run preprocessing that was waiting
 * on MikeGC's questions when a lawyer stopped them. Both are safe to repeat
 * on a replayed receipt. A failure here never fails the command: the outbox
 * row stays pending and the request page offers Retry.
 */
async function afterCommand(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  result: ServiceResult<CommandReceipt>,
): Promise<ServiceResult<IntakeReceipt>> {
  if (!result.ok) return result;
  const { preprocess, ...receipt } = result.data;
  // A message that can't be queued is marked failed, which offers Retry.
  if (receipt.outbound_id)
    await dispatchIntakeDeliverOrFail(db, scope.orgId, receipt.outbound_id).catch((error) =>
      console.warn("[intake] delivery not queued", safeError(error)),
    );
  if (preprocess)
    await queueNextIntakePreprocess(db, scope.orgId, requestId).catch((error) =>
      console.warn("[intake] preprocessing not queued", safeError(error)),
    );
  return ok(receipt);
}

/** Run one request command; each SQL wrapper takes only the arguments it declares. */
export async function commandIntakeRequest(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  action: IntakeCommandAction,
  input: IntakeCommandInput,
): Promise<ServiceResult<IntakeReceipt>> {
  const args: Record<string, unknown> = {
    ...scoped(scope),
    p_command: input.command_id,
    p_request: requestId,
  };
  if (action !== "notes") args.p_version = input.expected_version;
  if (action === "assignment") args.p_assignee = input.assignee_id ?? null;
  // Resolving needs no text, but its function still takes p_body: an absent
  // value would be dropped from the call and match no signature.
  if (["notes", "resolve", "cancel"].includes(action))
    args.p_body = input.body ?? null;
  if ((action === "wait" || action === "resume") && input.body !== undefined)
    args.p_body = input.body;
  // Only a message sent to the requester names p_send, so other calls match
  // the wrappers' shorter signatures.
  if ((action === "wait" || action === "resolve") && input.send_to_requester) {
    args.p_send = true;
    if (action === "resolve") {
      args.p_documents = input.documents ?? [];
      // Only the reply is sent; the resolution stays in the app.
      if (input.reply !== undefined) args.p_reply = input.reply;
    }
  }
  const result = await intakeRpc<CommandReceipt>(db, COMMAND_RPC[action], args);
  return afterCommand(db, scope, requestId, result);
}

export async function editIntakeRequest(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  input: IntakeDetails & { command_id: string; expected_version: number },
): Promise<ServiceResult<IntakeReceipt>> {
  const result = await intakeRpc<CommandReceipt>(db, "intake_edit_request", {
    ...scoped(scope),
    p_command: input.command_id,
    p_request: requestId,
    p_version: input.expected_version,
    ...detailArgs(input),
  });
  return afterCommand(db, scope, requestId, result);
}

/** Send a message to the requester again, after it couldn't be sent. */
export async function retryIntakeDelivery(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  outboundId: string,
): Promise<ServiceResult<{ retried: boolean }>> {
  const result = await intakeRpc<boolean>(db, "intake_retry_delivery", {
    ...scoped(scope),
    p_request: requestId,
    p_outbound: outboundId,
  });
  if (!result.ok) return result;
  if (result.data) await dispatchIntakeDeliverOrFail(db, scope.orgId, outboundId);
  return ok({ retried: result.data });
}

/**
 * Opening a request clears its New reply flag in the queue. `seenAt` is the
 * last reply the member was shown, so a reply that arrives while the page
 * loads stays new; without it, every reply until now counts as seen.
 */
export async function markIntakeReplySeen(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  seenAt: string | null = null,
): Promise<ServiceResult<{ ok: true }>> {
  const result = await intakeRpc<null>(db, "intake_mark_reply_seen", {
    ...scoped(scope),
    p_request: requestId,
    p_seen: seenAt,
  });
  return result.ok ? ok({ ok: true }) : result;
}

/** Only the known outbox rows that the page is still waiting on. */
export function getIntakeDeliveryStatus(db: Db, scope: IntakeScope, requestId: string, ids: string[]) {
  return intakeRpc<IntakeDelivery[]>(db, "intake_delivery_status", {
    ...scoped(scope), p_request: requestId, p_outbound: ids,
  });
}
