import type { IntakeChannel } from "@mike/contracts";
import { internalFailure, ok } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import type { AutomationRow } from "./intake.settingsRow";
import { insertInbound, type InboundStoreResult } from "./intake.inboundStore";
import { intakeRpc } from "./intake.shared";

/**
 * The channel-agnostic half of MikeGC's conversation with a requester. A
 * request recorded from a channel is linked to its thread; a message in that
 * thread is routed to the request as a reply; a message for the requester is
 * written to the outbox and sent by its channel's adapter. Each channel's
 * adapter does two things: classify what arrives, and deliver one message.
 */

export type ChannelSource = IntakeChannel;

/** A request's thread, as intake_channel_links stores it. */
export type ChannelLink = {
  id: string;
  org_id: string;
  request_id: string;
  source: ChannelSource;
  thread_key: string;
  /** What the adapter needs to post in the thread. */
  address: Record<string, unknown>;
};

/** One message for the requester, as every adapter receives it. */
export type OutboundMessage = {
  /** intake_outbound.id, fixed before sending. */
  id: string;
  kind: "acknowledgement" | "question" | "answer";
  author: { kind: "mikegc" } | { kind: "member"; name: string };
  /**
   * Plain text; each adapter formats and escapes it. An acknowledgement's
   * text is its first line; any questions follow in `questions`.
   */
  text: string;
  /** The request's subject, which an email's subject and a Teams folder follow. */
  requestSubject: string;
  /** An acknowledgement's link to the request and who it went to. */
  acknowledgement?: { subject: string; link: string; assignee: string | null };
  documents: OutboundDocument[];
};

/** A document to send, with what an earlier attempt already did with it. */
export type OutboundDocument = {
  documentId: string;
  versionId: string;
  name: string;
  fileType: string;
  sizeBytes: number | null;
  /** The channel's ID for it, once posted. */
  externalId?: string | null;
  /** It couldn't be sent, such as an email over the size limit. */
  leftOut?: boolean;
};

/** What an adapter sends with, read fresh for each delivery. */
export type ChannelContext = {
  db: Db;
  settings: AutomationRow;
  /** Read a document's bytes for sending. */
  readDocument: (doc: OutboundDocument) => Promise<ArrayBuffer>;
  /**
   * Save progress before finishing: the message's ID once its text lands,
   * and each document's ID as it lands, so a retry does neither again.
   */
  saveProgress: (progress: {
    externalId?: string;
    documents?: OutboundDocument[];
  }) => Promise<void>;
  /** The sender name the team's messages go out under, such as "Legal". */
  fromName: string;
};

export type DeliveryResult = {
  externalId: string;
  /** The documents as they ended: posted, or left out. */
  documents: OutboundDocument[];
};

export interface ChannelAdapter {
  source: ChannelSource;
  /**
   * Post one message in the linked thread; returns the channel's ID for it.
   * `delivered` is the ID of its text when an earlier attempt posted it, so
   * only what is left (such as documents) is sent.
   */
  deliver(
    ctx: ChannelContext,
    link: ChannelLink,
    message: OutboundMessage,
    delivered: string | null,
  ): Promise<DeliveryResult>;
  /** The channel's ID for an earlier send of this outbox row, if one landed. */
  findDelivered(
    ctx: ChannelContext,
    link: ChannelLink,
    message: OutboundMessage,
    attemptedAt: string | null,
  ): Promise<string | null>;
}

/**
 * A delivery that failed. `permanent` failures need someone to change a
 * setting or the channel, and are not retried; the sentence is what members
 * see on the request, written by MikeGC from a known failure, never a
 * provider's response.
 */
export class ChannelDeliveryError extends Error {
  readonly permanent: boolean;
  readonly sentence: string;
  constructor(sentence: string, permanent: boolean) {
    super(sentence);
    this.name = "ChannelDeliveryError";
    this.sentence = sentence.slice(0, 200);
    this.permanent = permanent;
  }
}

/** "Emma Chen (Legal)": a member's name as their messages are signed. */
export function memberSender(name: string, fromName: string): string {
  return `${name} (${fromName})`.slice(0, 80);
}

/**
 * A message as plain text, for channels that cannot change the sender of
 * one message: a member's question reads "Emma Chen (Legal) asks: …".
 * MikeGC's own wording frames an acknowledgement.
 */
export function plainMessageText(
  message: OutboundMessage,
  options: { fromName: string; signMember: boolean },
): string {
  const lines: string[] = [];
  if (message.acknowledgement) {
    const ack = message.acknowledgement;
    lines.push(
      `Logged for Legal: ${ack.subject} (${ack.link}). ` +
        (ack.assignee ? `Assigned to ${ack.assignee}.` : "Not assigned to a reviewer yet."),
    );
    if (message.text) lines.push("", message.text);
    return lines.join("\n");
  }
  const text = message.text || (message.documents.length ? "Legal sent these documents." : "");
  if (options.signMember && message.author.kind === "member") {
    const who = memberSender(message.author.name, options.fromName);
    return message.kind === "question" ? `${who} asks:\n${text}` : `${who}:\n${text}`;
  }
  return text;
}

const LINK_COLUMNS = "id, org_id, request_id, source, thread_key, address";

/** The thread a message arrived in, if a request is linked to it. */
export async function findThreadLink(
  db: Db,
  orgId: string,
  source: ChannelSource,
  threadKey: string,
): Promise<ChannelLink | null> {
  const { data, error } = await db
    .from("intake_channel_links")
    .select(LINK_COLUMNS)
    .eq("org_id", orgId)
    .eq("source", source)
    .eq("thread_key", threadKey)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLink | null) ?? null;
}

/** A request's thread, or null when it has none. */
export async function loadRequestLink(
  db: Db,
  orgId: string,
  requestId: string,
): Promise<ChannelLink | null> {
  const { data, error } = await db
    .from("intake_channel_links")
    .select(LINK_COLUMNS)
    .eq("org_id", orgId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLink | null) ?? null;
}

export async function loadLinkById(db: Db, linkId: string): Promise<ChannelLink | null> {
  const { data, error } = await db
    .from("intake_channel_links")
    .select(LINK_COLUMNS)
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLink | null) ?? null;
}

/**
 * Link a recorded request to its thread. A thread already linked to another
 * request leaves this one without a link: null.
 */
export async function linkThread(
  db: Db,
  args: {
    orgId: string;
    requestId: string;
    source: ChannelSource;
    threadKey: string;
    address: Record<string, unknown>;
  },
): Promise<string | null> {
  const result = await intakeRpc<string | null>(db, "intake_link_thread", {
    p_org: args.orgId,
    p_request: args.requestId,
    p_source: args.source,
    p_thread_key: args.threadKey,
    p_address: args.address,
  });
  if (!result.ok) {
    if (result.kind === "not_found") return null;
    throw result.kind === "error" ? result.error : new Error(result.detail);
  }
  return result.data;
}

/**
 * Merge fields into a link's address, such as the newest message to reply
 * to, or a Teams service URL Microsoft moved.
 */
export async function updateLinkAddress(
  db: Db,
  link: ChannelLink,
  patch: Record<string, unknown>,
): Promise<void> {
  const changed = Object.entries(patch).some(
    ([key, value]) => JSON.stringify(link.address[key]) !== JSON.stringify(value),
  );
  if (!changed) return;
  const address = { ...link.address, ...patch };
  const { error } = await db
    .from("intake_channel_links")
    .update({ address })
    .eq("id", link.id);
  if (error) throw error;
  link.address = address;
}

/**
 * Store a message in a request's thread as a reply, once, and queue the
 * intake.reply job for it. Its content is kept only until the job has put it
 * on the request. A delivery seen before is not stored again; one still
 * waiting is queued again in case the first delivery couldn't queue it.
 */
export async function routeThreadMessage(
  db: Db,
  args: {
    orgId: string;
    source: ChannelSource;
    externalId: string;
    requestId: string;
    payload: Record<string, unknown>;
    dispatch: (db: Db, orgId: string, inboundId: string) => Promise<void>;
  },
): Promise<InboundStoreResult<"received" | "duplicate">> {
  const stored = await insertInbound(db, {
    org_id: args.orgId,
    source: args.source,
    kind: "reply",
    external_id: args.externalId,
    status: "pending",
    request_id: args.requestId,
    payload: args.payload,
  });
  if (!stored.ok) return stored;
  // Ownership follows the INSERT, not whether its subsequent job dispatch
  // succeeds. A duplicate's newly staged payload was never stored.
  const payloadOwnership = stored.payloadOwnership;
  let inboundId = stored.data;
  let status: "received" | "duplicate" = "received";
  if (inboundId === null) {
    status = "duplicate";
    const existing = await db
      .from("intake_inbound")
      .select("id, status")
      .eq("org_id", args.orgId)
      .eq("source", args.source)
      .eq("external_id", args.externalId)
      .maybeSingle();
    if (existing.error) return Object.assign(internalFailure(existing.error), { payloadOwnership });
    const row = existing.data as { id: string; status: string } | null;
    if (row?.status === "pending") inboundId = row.id;
  }
  if (inboundId) {
    try {
      await args.dispatch(db, args.orgId, inboundId);
    } catch (cause) {
      return Object.assign(internalFailure(cause), { payloadOwnership });
    }
  }
  return Object.assign(ok(status), { payloadOwnership });
}
