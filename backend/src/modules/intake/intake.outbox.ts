import type { Db } from "../../lib/supabase";
import {
  acknowledgementId,
  questionBody,
  questionIds,
  stableId,
  type ThreadEntry,
} from "./intake.clarify";
import { dispatchIntakeDeliver } from "./intake.deliver";
import { intakeRpc } from "./intake.shared";
import { formatSent } from "./intake.triage";

/**
 * Writing MikeGC's own messages for the requester to the outbox: its
 * clarifying questions and its acknowledgement. Each is written in the same
 * transaction as what it carries, then handed to intake.deliver.
 */

/**
 * MikeGC asks in a request's thread. The question and its outbox row are
 * named from `seed`, so asking again adds nothing. False when it may no
 * longer ask: a lawyer has taken over, the rounds are used up, or the
 * request is closed or has no thread.
 */
export async function askRequester(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    seed: string;
    questions: string[];
    stage: "rule" | "readiness";
    acknowledge: boolean;
    /** The rule's preprocessing, which the round after an answer runs. */
    preprocess?: Record<string, unknown> | null;
  },
): Promise<boolean> {
  const ids = questionIds(args.seed);
  const asked = await intakeRpc<boolean>(db, "intake_ask_automated", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_outbound: ids.outboundId,
    p_message: ids.messageId,
    p_body: questionBody(args.questions, args.stage),
    p_stage: args.stage,
    p_acknowledge: args.acknowledge,
    p_preprocess: args.preprocess ?? null,
  });
  if (!asked.ok) {
    if (asked.kind === "not_found") return false;
    throw asked.kind === "error" ? asked.error : new Error(asked.detail);
  }
  if (asked.data) await dispatchIntakeDeliver(db, args.orgId, ids.outboundId);
  return asked.data;
}

/**
 * MikeGC answers in a request's thread without asking: the request doesn't
 * wait. Named from `seed`, so answering again adds nothing. False when the
 * request is closed or has no thread.
 */
export async function answerRequester(
  db: Db,
  args: { orgId: string; requestId: string; seed: string; text: string },
): Promise<boolean> {
  const ids = {
    messageId: stableId(`intake.answer:${args.seed}`),
    outboundId: stableId(`intake.answer.outbound:${args.seed}`),
  };
  const answered = await intakeRpc<boolean>(db, "intake_answer_automated", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_outbound: ids.outboundId,
    p_message: ids.messageId,
    p_body: args.text,
  });
  if (!answered.ok) {
    if (answered.kind === "not_found") return false;
    throw answered.kind === "error" ? answered.error : new Error(answered.detail);
  }
  if (answered.data) await dispatchIntakeDeliver(db, args.orgId, ids.outboundId);
  return answered.data;
}

/** MikeGC's acknowledgement in a request's thread, once. */
export async function acknowledgeRequest(
  db: Db,
  orgId: string,
  requestId: string,
): Promise<void> {
  const ack = await intakeRpc<string | null>(db, "intake_acknowledge_automated", {
    p_org: orgId,
    p_request: requestId,
    p_outbound: acknowledgementId(requestId),
  });
  if (!ack.ok) {
    if (ack.kind === "not_found") return;
    throw ack.kind === "error" ? ack.error : new Error(ack.detail);
  }
  if (ack.data) await dispatchIntakeDeliver(db, orgId, ack.data);
}

/**
 * The stage MikeGC was waiting on is settled: the request returns to New or
 * In progress, assigned to the rule's member when the rule stage settles.
 * False when the request no longer waits on that stage.
 */
export async function settleClarify(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    stage: "rule" | "readiness";
    assign?: boolean;
    assigneeId?: string | null;
  },
): Promise<boolean> {
  const settled = await intakeRpc<boolean>(db, "intake_settle_clarify_automated", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_stage: args.stage,
    p_assign: args.assign ?? false,
    p_assignee: args.assigneeId ?? null,
  });
  if (!settled.ok) {
    if (settled.kind === "not_found") return false;
    throw settled.kind === "error" ? settled.error : new Error(settled.detail);
  }
  return settled.data;
}

/**
 * The thread after a request, oldest first: what MikeGC and members sent the
 * requester and the requester's replies, as the stages read it; the 50
 * newest when there are more.
 */
export async function loadThreadEntries(
  db: Db,
  orgId: string,
  requestId: string,
): Promise<ThreadEntry[]> {
  const { data, error } = await db
    .from("intake_messages")
    .select("kind, body, created_at, automated, external_author")
    .eq("org_id", orgId)
    .eq("request_id", requestId)
    .in("kind", ["question", "answer", "reply"])
    // The 50 newest, read back oldest first.
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (
    [...((data ?? []) as unknown[])].reverse() as {
      kind: "question" | "answer" | "reply";
      body: string;
      created_at: string;
      automated: boolean;
      external_author: { name?: string | null } | null;
    }[]
  ).map((m) => ({
    author:
      m.kind === "reply"
        ? `${m.external_author?.name?.trim() || "The requester"} (requester)`
        : m.automated
          ? "MikeGC"
          : "Legal",
    at: formatSent(new Date(m.created_at)),
    text: m.body,
  }));
}
