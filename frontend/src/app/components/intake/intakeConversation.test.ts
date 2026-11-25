import { describe, expect, it } from "vitest";
import type { IntakeConversation, IntakeDelivery } from "@mike/contracts";
import {
  INTAKE_SOURCE_LABELS,
  intakeAudience,
  intakeConversationLink,
  intakeDeliveryStatus,
  intakeDocumentsUnavailable,
  intakeLeftOutDocuments,
  intakeReplyLabel,
} from "./intakeConversation";

const conversation = (
  overrides: Partial<IntakeConversation> = {},
): IntakeConversation => ({
  source: "slack",
  channel_name: "legal-requests",
  team_name: null,
  permalink: null,
  mailbox: null,
  to: [],
  cc: [],
  max_attachment_bytes: null,
  documents: true,
  ...overrides,
});
const MB = 1024 * 1024;

describe("intakeReplyLabel", () => {
  it("names where the reply goes", () => {
    expect(intakeReplyLabel(conversation())).toBe("Send reply in Slack");
    expect(intakeReplyLabel(conversation({ source: "teams" }))).toBe(
      "Send reply in Teams",
    );
    expect(intakeReplyLabel(conversation({ source: "gmail" }))).toBe(
      "Send reply by email",
    );
  });
});

describe("intakeAudience", () => {
  it("says a Slack or Teams thread is visible to everyone in its channel", () => {
    expect(intakeAudience(conversation())).toBe(
      "Posts in the Slack thread in #legal-requests, visible to everyone in the channel.",
    );
    expect(intakeAudience(conversation({ channel_name: null }))).toBe(
      "Posts in the Slack thread, visible to everyone in the channel.",
    );
    expect(
      intakeAudience(
        conversation({ source: "teams", channel_name: "Legal", team_name: "Acme" }),
      ),
    ).toBe(
      "Posts in the Teams channel Legal in Acme, visible to everyone in the channel.",
    );
    expect(
      intakeAudience(conversation({ source: "teams", channel_name: null })),
    ).toBe("Posts in the Teams thread, visible to everyone in the channel.");
  });

  it("names an email's recipients", () => {
    expect(
      intakeAudience(
        conversation({
          source: "outlook",
          to: ["ana@example.com"],
          cc: ["ben@example.com", "cy@example.com"],
        }),
      ),
    ).toBe("Emails ana@example.com, cc ben@example.com, cy@example.com.");
    expect(intakeAudience(conversation({ source: "gmail" }))).toBe(
      "Emails the requester.",
    );
  });
});

describe("intakeLeftOutDocuments", () => {
  const email = conversation({
    source: "gmail",
    max_attachment_bytes: 25 * MB,
  });

  it("leaves out the first document past the limit, and every one after it", () => {
    expect(
      intakeLeftOutDocuments(email, [
        { document_id: "a", size_bytes: 20 * MB },
        { document_id: "b", size_bytes: 10 * MB },
        // Small enough to fit, but after one that didn't.
        { document_id: "c", size_bytes: 1 * MB },
      ]),
    ).toEqual(["b", "c"]);
    expect(
      intakeLeftOutDocuments(email, [
        { document_id: "a", size_bytes: 20 * MB },
        { document_id: "c", size_bytes: 1 * MB },
      ]),
    ).toEqual([]);
  });

  it("leaves nothing out of a channel without a size limit", () => {
    expect(
      intakeLeftOutDocuments(conversation(), [
        { document_id: "a", size_bytes: 200 * MB },
      ]),
    ).toEqual([]);
  });
});

describe("intakeDocumentsUnavailable", () => {
  it("says why a channel can take text only", () => {
    expect(intakeDocumentsUnavailable(conversation())).toBeNull();
    expect(intakeDocumentsUnavailable(conversation({ documents: false }))).toBe(
      "Reinstall the Slack app to send documents.",
    );
    expect(
      intakeDocumentsUnavailable(
        conversation({ source: "teams", documents: false }),
      ),
    ).toMatch(/Teams document access isn't set up/);
  });
});

describe("intakeDeliveryStatus", () => {
  const delivery = (overrides: Partial<IntakeDelivery>): IntakeDelivery => ({
    outbound_id: "o",
    kind: "question",
    status: "pending",
    error: null,
    sent_at: null,
    message_id: null,
    documents: [],
    ...overrides,
  });
  it("reads as plain words", () => {
    expect(intakeDeliveryStatus(delivery({}))).toBe("Sending");
    expect(intakeDeliveryStatus(delivery({ status: "sent" }))).toBe("Sent");
    expect(
      intakeDeliveryStatus(
        delivery({
          status: "failed",
          error: "MikeGC was removed from #legal.",
        }),
      ),
    ).toBe("Couldn't send: MikeGC was removed from #legal.");
  });
});

describe("intakeConversationLink", () => {
  it("offers only an https link", () => {
    expect(
      intakeConversationLink(
        conversation({ permalink: "https://acme.slack.com/archives/C1/p1" }),
      ),
    ).toBe("https://acme.slack.com/archives/C1/p1");
    expect(
      intakeConversationLink(
        conversation({ permalink: "javascript:alert(1)" }),
      ),
    ).toBeNull();
    expect(intakeConversationLink(conversation())).toBeNull();
  });
});

describe("source labels", () => {
  it("names every source", () => {
    expect(INTAKE_SOURCE_LABELS).toEqual({
      manual: "Manual",
      outlook: "Outlook",
      gmail: "Gmail",
      teams: "Teams",
      slack: "Slack",
    });
  });
});
