import type {
  IntakeDetails,
  IntakeEvent,
  IntakeMember,
  IntakeMessage,
  IntakeReceipt,
  IntakeRequest,
  IntakeRequestPage,
  IntakeRequestSummary,
} from "@mike/contracts";
import type { Db } from "../../lib/supabase";
import { failure, ok, type ServiceResult } from "../../lib/serviceResult";
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
  p_category: d.category,
  p_subject: d.subject,
  p_description: d.description,
  p_requester_name: d.requester_name,
  p_requester_email: d.requester_email,
  p_requester_team: d.requester_team,
  p_date: d.requested_by_date,
  p_timezone: d.timezone,
});

export function listIntakeMembers(db: Db, scope: IntakeScope) {
  return intakeRpc<IntakeMember[]>(db, "intake_members", scoped(scope));
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
    category?: "nda" | "general";
    assignee?: string;
    search: string;
    sort: "updated" | "target";
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
    p_category: filters.category ?? null,
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
};

/** Run one request command; each SQL wrapper takes only the arguments it declares. */
export function commandIntakeRequest(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  action: IntakeCommandAction,
  input: IntakeCommandInput,
) {
  const args: Record<string, unknown> = {
    ...scoped(scope),
    p_command: input.command_id,
    p_request: requestId,
  };
  if (action !== "notes") args.p_version = input.expected_version;
  if (action === "assignment") args.p_assignee = input.assignee_id ?? null;
  if (["notes", "resolve", "cancel"].includes(action)) args.p_body = input.body;
  if ((action === "wait" || action === "resume") && input.body !== undefined)
    args.p_body = input.body;
  return intakeRpc<IntakeReceipt>(db, COMMAND_RPC[action], args);
}

export function editIntakeRequest(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  input: IntakeDetails & { command_id: string; expected_version: number },
) {
  return intakeRpc<IntakeReceipt>(db, "intake_edit_request", {
    ...scoped(scope),
    p_command: input.command_id,
    p_request: requestId,
    p_version: input.expected_version,
    ...detailArgs(input),
  });
}
