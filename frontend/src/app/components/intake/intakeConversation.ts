import type {
  IntakeChannel,
  IntakeConversation,
  IntakeDelivery,
  IntakeDocument,
  IntakeSource,
} from "@mike/contracts";

/** The channels MikeGC talks to requesters in, as Legal names them. */
export const INTAKE_CHANNEL_LABELS: Record<IntakeChannel, string> = {
  slack: "Slack",
  outlook: "Outlook",
  gmail: "Gmail",
  teams: "Teams",
};

/** Where a request came from. */
export const INTAKE_SOURCE_LABELS: Record<IntakeSource, string> = {
  manual: "Manual",
  ...INTAKE_CHANNEL_LABELS,
};

/** Outlook and Gmail threads are email: recipients rather than a channel. */
export function isEmailConversation(conversation: IntakeConversation) {
  return conversation.source === "outlook" || conversation.source === "gmail";
}

/** The switch that sends the resolution to the requester, named for where it goes. */
export function intakeReplyLabel(conversation: IntakeConversation): string {
  return isEmailConversation(conversation)
    ? "Send reply by email"
    : `Send reply in ${INTAKE_CHANNEL_LABELS[conversation.source]}`;
}

/**
 * Who a message sent to the requester reaches, as the send controls say it:
 * a Slack or Teams thread is visible to everyone in its channel, and an
 * email goes to the thread's recipients.
 */
export function intakeAudience(conversation: IntakeConversation): string {
  if (isEmailConversation(conversation)) {
    const to = conversation.to.length
      ? conversation.to.join(", ")
      : "the requester";
    const cc = conversation.cc.length
      ? `, cc ${conversation.cc.join(", ")}`
      : "";
    return `Emails ${to}${cc}.`;
  }
  const channel = conversation.channel_name?.replace(/^#/, "");
  if (conversation.source === "teams")
    return channel
      ? `Posts in the Teams channel ${channel}${conversation.team_name ? ` in ${conversation.team_name}` : ""}, visible to everyone in the channel.`
      : "Posts in the Teams thread, visible to everyone in the channel.";
  return channel
    ? `Posts in the Slack thread in #${channel}, visible to everyone in the channel.`
    : "Posts in the Slack thread, visible to everyone in the channel.";
}

/** Why a channel can take only text, or null when documents can be sent. */
export function intakeDocumentsUnavailable(
  conversation: IntakeConversation,
): string | null {
  if (conversation.documents) return null;
  if (conversation.source === "slack")
    return "Reinstall the Slack app to send documents.";
  if (conversation.source === "teams")
    return "Teams document access isn't set up, so documents can't be sent.";
  return "Documents can't be sent in this thread.";
}

/**
 * The documents an email may leave out, as the server decides it: walking
 * the ticked documents in the order they were ticked and adding up their
 * sizes, the first that would take the total past the mailbox's limit, and
 * every one after it, are named in the email instead of attached. Gmail
 * measures its limit after encoding, so the server may leave out a little
 * more than this says. A document whose size is unknown counts as empty.
 */
export function intakeLeftOutDocuments(
  conversation: IntakeConversation,
  ticked: Pick<IntakeDocument, "document_id" | "size_bytes">[],
): string[] {
  const limit = conversation.max_attachment_bytes;
  if (!isEmailConversation(conversation) || !limit) return [];
  let total = 0;
  for (const [index, document] of ticked.entries()) {
    total += document.size_bytes ?? 0;
    if (total > limit) return ticked.slice(index).map((d) => d.document_id);
  }
  return [];
}

/**
 * How a message to the requester is going, in plain words: "Sending",
 * "Sent", or why it couldn't be sent.
 */
export function intakeDeliveryStatus(delivery: IntakeDelivery): string {
  if (delivery.status === "sent") return "Sent";
  if (delivery.status === "failed")
    return `Couldn't send: ${delivery.error ?? "MikeGC couldn't send this message."}`;
  return "Sending";
}

/** A link to the request's thread, when the channel has one. */
export function intakeConversationLink(
  conversation: IntakeConversation,
): string | null {
  const link = conversation.permalink;
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    // A malformed link is not offered: the channel name still says where.
    return null;
  }
}
