import type { IntakeNotification } from "@mike/contracts";
import { INTAKE_CHANNEL_LABELS } from "./intakeConversation";
import { intakeRequestHref, intakeRequestsHref } from "./intakeQuery";

export const NEW_INTAKE_REQUEST_TITLE = "New Intake Request";
export const INTAKE_REQUEST_UPDATE_TITLE = "Intake request update";

/** At most this many toasts for one check; the rest are summed up in one. */
export const MAX_INTAKE_NOTIFICATION_TOASTS = 3;

/** Longer than an ordinary notice: it names a request and offers to open it. */
export const INTAKE_NOTIFICATION_TOAST_MS = 10_000;

/** What one toast says, before it is drawn. */
export interface IntakeNotificationToast {
  /** Toasts with the same key replace each other: one per request. */
  key: string;
  /** Names the workspace too when it isn't the one open. */
  title: string;
  /** The request's subject; a summary of several requests has none. */
  subject: string | null;
  line: string;
  /** Where its action goes, or null when it has none. */
  action: { label: string; href: string } | null;
}

/** "Intake request update (in Contoso Legal)", or the title alone. */
function inWorkspace(title: string, workspaceName: string | null) {
  return workspaceName ? `${title} (in ${workspaceName})` : title;
}

export function intakeNotificationTitle(
  notification: Pick<IntakeNotification, "kind">,
) {
  return notification.kind === "new_request"
    ? NEW_INTAKE_REQUEST_TITLE
    : INTAKE_REQUEST_UPDATE_TITLE;
}

function actorOf(notification: IntakeNotification) {
  if (notification.actor_name) return notification.actor_name;
  if (notification.automated) return "MikeGC";
  return notification.change === "reply" ? "The requester" : "A former member";
}

/** "Sam Colleague assigned it to you", read under the request's subject. */
export function intakeNotificationLine(notification: IntakeNotification) {
  const actor = actorOf(notification);
  const line = changeLine(notification, actor);
  const more = notification.more;
  if (!more) return line;
  return `${line} · ${more} more ${more === 1 ? "update" : "updates"}`;
}

function changeLine(notification: IntakeNotification, actor: string) {
  const automated = notification.automated;
  switch (notification.change) {
    case "submitted":
      return automated
        ? "MikeGC recorded it and assigned it to you"
        : `${actor} created it and assigned it to you`;
    case "assign":
      return `${actor} assigned it to you`;
    case "reply":
      return notification.channel
        ? `${actor} replied in ${INTAKE_CHANNEL_LABELS[notification.channel]}`
        : `${actor} replied`;
    case "note":
      return `${actor} commented`;
    case "preprocessing":
      return "MikeGC preprocessed it";
    case "wait":
      return automated
        ? "MikeGC asked the requester for details"
        : `${actor} marked it waiting on the requester`;
    case "resume":
      return automated ? "It's back in progress" : `${actor} resumed it`;
    case "resolve":
      return `${actor} resolved it`;
    case "cancel":
      return `${actor} cancelled it`;
    case "reopen":
      return `${actor} reopened it`;
    case "stop_asking":
      return `${actor} stopped MikeGC asking the requester`;
    case "edited":
      return `${actor} edited the details`;
    case "document_added":
      return `${actor} added a document`;
    default:
      return `${actor} updated it`;
  }
}

/**
 * The toasts for one check, oldest first. Each request gets its own toast
 * with Open; past `MAX_INTAKE_NOTIFICATION_TOASTS`, the newest keep theirs
 * and the others are summed up in one, which lists the member's requests
 * when they are all in the open workspace.
 */
export function planIntakeNotificationToasts(
  notifications: readonly IntakeNotification[],
  context: { workspaceId: string | null; accountId: string | undefined },
): IntakeNotificationToast[] {
  const one = (notification: IntakeNotification): IntakeNotificationToast => ({
    key: `intake-notification:${notification.workspace}:${notification.request_id}`,
    title: inWorkspace(
      intakeNotificationTitle(notification),
      notification.workspace === context.workspaceId
        ? null
        : notification.workspace_name,
    ),
    subject: notification.subject,
    line: intakeNotificationLine(notification),
    action: {
      label: "Open",
      href: intakeRequestHref(notification.workspace, notification.request_id),
    },
  });
  if (notifications.length <= MAX_INTAKE_NOTIFICATION_TOASTS)
    return notifications.map(one);
  const shown = notifications.slice(-(MAX_INTAKE_NOTIFICATION_TOASTS - 1));
  const rest = notifications.slice(0, notifications.length - shown.length);
  return [summaryToast(rest, context), ...shown.map(one)];
}

function summaryToast(
  rest: readonly IntakeNotification[],
  context: { workspaceId: string | null; accountId: string | undefined },
): IntakeNotificationToast {
  const fresh = rest.filter((n) => n.kind === "new_request").length;
  const count = rest.length;
  const requests = count === 1 ? "request" : "requests";
  const line =
    fresh === count
      ? `${count} more ${requests} ${count === 1 ? "was" : "were"} assigned to you`
      : fresh === 0
        ? `${count} more of your requests ${count === 1 ? "was" : "were"} updated`
        : `${count} more ${requests} ${count === 1 ? "was" : "were"} assigned to you or updated`;
  const workspaces = new Set(rest.map((n) => n.workspace));
  const [only] = workspaces;
  const inOpenWorkspace = workspaces.size === 1 && only === context.workspaceId;
  return {
    key: "intake-notification:summary",
    title: inWorkspace(
      fresh ? NEW_INTAKE_REQUEST_TITLE : INTAKE_REQUEST_UPDATE_TITLE,
      workspaces.size === 1 && !inOpenWorkspace ? rest[0].workspace_name : null,
    ),
    subject: null,
    line,
    // The list shows the open workspace's requests only.
    action:
      inOpenWorkspace && context.accountId
        ? {
            label: "View requests",
            href: intakeRequestsHref({ assignee: context.accountId }),
          }
        : null,
  };
}

/** Raised on the window once toasts are shown, so open intake views refresh. */
export const INTAKE_NOTIFIED_EVENT = "mike:intake-notified";

export interface IntakeNotifiedDetail {
  /** The requests each workspace has news about. */
  requests: { workspace: string; request_id: string }[];
}

export function announceIntakeNotifications(
  notifications: readonly IntakeNotification[],
) {
  const detail: IntakeNotifiedDetail = {
    requests: notifications.map(({ workspace, request_id }) => ({
      workspace,
      request_id,
    })),
  };
  window.dispatchEvent(new CustomEvent(INTAKE_NOTIFIED_EVENT, { detail }));
}

/**
 * Calls `listener` when there is news about a request in `workspace`, with
 * those requests' IDs. Returns the unsubscribe function.
 */
export function onIntakeNotified(
  workspace: string,
  listener: (requestIds: string[]) => void,
) {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<IntakeNotifiedDetail>).detail;
    const ids = (detail?.requests ?? [])
      .filter((request) => request.workspace === workspace)
      .map((request) => request.request_id);
    if (ids.length) listener(ids);
  };
  window.addEventListener(INTAKE_NOTIFIED_EVENT, handle);
  return () => window.removeEventListener(INTAKE_NOTIFIED_EVENT, handle);
}
