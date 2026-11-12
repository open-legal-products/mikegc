import type { IntakeEvent, IntakeMessage } from "@mike/contracts";
import { INTAKE_CHANNEL_LABELS } from "./intakeConversation";

/**
 * One line of the activity timeline, read as "<actor> <action>", such as
 * "Sam Colleague marked this waiting on the requester". A change no person
 * made has no actor, and its action is a whole sentence.
 */
export type IntakeActivityLine = { actor: string | null; action: string };

export function describeIntakeEvent(event: IntakeEvent): IntakeActivityLine {
  const action = eventAction(event);
  if (event.actor_name) return { actor: event.actor_name, action };
  // Legacy replies came from the requester, who was never a member.
  if (event.kind === "reply")
    return { actor: null, action: "The requester replied" };
  return { actor: null, action: `Automatically ${action}` };
}

function eventAction(event: IntakeEvent): string {
  switch (event.kind) {
    case "submitted":
      return event.assignee_name
        ? `created this and assigned it to ${event.assignee_name}`
        : "created this";
    case "assign":
      return event.assignee_name
        ? `assigned this to ${event.assignee_name}`
        : "unassigned this";
    case "wait":
      return "marked this waiting on the requester";
    case "resume":
      return "resumed this";
    case "resolve":
      return "resolved this";
    case "cancel":
      return "cancelled this";
    case "reopen":
      return "reopened this";
    case "stop_asking":
      return "stopped MikeGC asking the requester";
    case "edited":
      return "edited the details";
    case "document_added":
      return "added a document";
    case "assignee_left":
      return `unassigned ${event.assignee_name ?? "the reviewer"} because they left the organization`;
    // Events recorded before intake became an internal tracker.
    case "ask":
      return "asked for information";
    case "reply":
      return "replied";
    case "publish":
      return "answered and resolved this";
    case "reviewer_removed":
      return "unassigned the reviewer when they left the Legal team";
    default:
      return event.kind.replaceAll("_", " ");
  }
}

const MESSAGE_ACTIONS: Record<IntakeMessage["kind"], string> = {
  note: "commented",
  resolution: "recorded the resolution",
  cancel_reason: "gave the reason for cancelling",
  // A member's question, or MikeGC's own, sent to the requester.
  question: "asked the requester",
  reply: "replied",
  // A resolution's reply to the requester, which reads in Messages.
  answer: "replied to the requester",
};

/**
 * A message's line; its text is shown below it. A requester's reply names
 * them and the channel it came in: "Ana Ruiz replied in Slack".
 */
export function describeIntakeMessage(
  message: IntakeMessage,
): IntakeActivityLine {
  const channel = message.external_author?.source;
  if (message.purpose === "preprocessing")
    return { actor: message.author_name, action: "preprocessed this request" };
  if (message.kind === "reply" && channel)
    return {
      actor: message.author_name,
      action: `replied in ${INTAKE_CHANNEL_LABELS[channel]}`,
    };
  return { actor: message.author_name, action: MESSAGE_ACTIONS[message.kind] };
}

/** What a message sent to the requester is called, to name it in a control. */
export function intakeOutgoingName(kind: "question" | "answer" | "resolution") {
  return kind === "question"
    ? "the question"
    : kind === "answer"
      ? "the reply"
      : "the resolution reply";
}
