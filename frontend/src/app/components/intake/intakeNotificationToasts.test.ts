import { describe, expect, it, vi } from "vitest";
import type { IntakeNotification } from "@mike/contracts";
import {
  INTAKE_REQUEST_UPDATE_TITLE,
  NEW_INTAKE_REQUEST_TITLE,
  announceIntakeNotifications,
  intakeNotificationLine,
  onIntakeNotified,
  planIntakeNotificationToasts,
} from "./intakeNotificationToasts";

const notification = (
  extra: Partial<IntakeNotification> = {},
): IntakeNotification => ({
  workspace: "org-1",
  workspace_name: "Acme Legal",
  request_id: "request-1",
  subject: "Supplier NDA",
  kind: "update",
  change: "note",
  actor_name: "Sam Colleague",
  automated: false,
  channel: null,
  more: 0,
  created_at: "2026-11-04T10:00:00Z",
  ...extra,
});
const open = { workspaceId: "org-1", accountId: "me" };

describe("intake notification wording", () => {
  it("says who made a request the member's", () => {
    expect(
      intakeNotificationLine(notification({ kind: "new_request", change: "assign" })),
    ).toBe("Sam Colleague assigned it to you");
    expect(
      intakeNotificationLine(
        notification({ kind: "new_request", change: "submitted", actor_name: null, automated: true }),
      ),
    ).toBe("MikeGC recorded it and assigned it to you");
    expect(
      intakeNotificationLine(notification({ kind: "new_request", change: "submitted" })),
    ).toBe("Sam Colleague created it and assigned it to you");
  });
  it("says what changed, naming the requester's channel and MikeGC", () => {
    const line = (extra: Partial<IntakeNotification>) =>
      intakeNotificationLine(notification(extra));
    expect(line({ change: "reply", actor_name: "Jane Business", channel: "slack" })).toBe(
      "Jane Business replied in Slack",
    );
    expect(line({ change: "reply", actor_name: null })).toBe("The requester replied");
    expect(line({ change: "note" })).toBe("Sam Colleague commented");
    expect(line({ change: "resolve" })).toBe("Sam Colleague resolved it");
    expect(line({ change: "wait", actor_name: null, automated: true })).toBe(
      "MikeGC asked the requester for details",
    );
    expect(line({ change: "preprocessing", actor_name: null, automated: true })).toBe(
      "MikeGC preprocessed it",
    );
    expect(line({ change: "edited", actor_name: null })).toBe("A former member edited the details");
  });
  it("counts the other changes", () => {
    expect(intakeNotificationLine(notification({ change: "resolve", more: 1 }))).toBe(
      "Sam Colleague resolved it · 1 more update",
    );
    expect(intakeNotificationLine(notification({ more: 3 }))).toBe(
      "Sam Colleague commented · 3 more updates",
    );
  });
});

describe("planIntakeNotificationToasts", () => {
  it("gives each request a titled toast that opens it, one per request", () => {
    expect(
      planIntakeNotificationToasts(
        [
          notification({ kind: "new_request", change: "assign" }),
          notification({ request_id: "request-2", workspace: "personal", workspace_name: "Personal" }),
        ],
        open,
      ),
    ).toEqual([
      {
        key: "intake-notification:org-1:request-1",
        title: NEW_INTAKE_REQUEST_TITLE,
        subject: "Supplier NDA",
        line: "Sam Colleague assigned it to you",
        action: { label: "Open", href: "/intake/request-1?org=org-1" },
      },
      expect.objectContaining({
        key: "intake-notification:personal:request-2",
        // Another workspace is named in the title.
        title: `${INTAKE_REQUEST_UPDATE_TITLE} (in Personal)`,
        action: { label: "Open", href: "/intake/request-2?org=personal" },
      }),
    ]);
  });
  it("keeps the newest two and sums up the rest past three", () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      notification({ request_id: `request-${n}`, kind: n < 3 ? "new_request" : "update" }),
    );
    const toasts = planIntakeNotificationToasts(many, open);
    expect(toasts.map((t) => t.key)).toEqual([
      "intake-notification:summary",
      "intake-notification:org-1:request-4",
      "intake-notification:org-1:request-5",
    ]);
    expect(toasts[0]).toEqual({
      key: "intake-notification:summary",
      title: NEW_INTAKE_REQUEST_TITLE,
      subject: null,
      line: "3 more requests were assigned to you or updated",
      action: { label: "View requests", href: "/intake/requests?assignee=me" },
    });
  });
  it("names the summary's workspace instead of listing another workspace's requests", () => {
    const elsewhere = [1, 2, 3, 4].map((n) =>
      notification({ request_id: `request-${n}`, workspace: "org-2", workspace_name: "Beta Legal" }),
    );
    const [summary] = planIntakeNotificationToasts(elsewhere, open);
    expect(summary).toMatchObject({
      title: `${INTAKE_REQUEST_UPDATE_TITLE} (in Beta Legal)`,
      line: "2 more of your requests were updated",
      action: null,
    });
  });
});

describe("onIntakeNotified", () => {
  it("passes on the news about one workspace's requests", () => {
    const listener = vi.fn();
    const stop = onIntakeNotified("org-1", listener);
    announceIntakeNotifications([
      notification(),
      notification({ workspace: "org-2", request_id: "request-9" }),
    ]);
    expect(listener).toHaveBeenCalledWith(["request-1"]);
    announceIntakeNotifications([notification({ workspace: "org-2" })]);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    announceIntakeNotifications([notification()]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
