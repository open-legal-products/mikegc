import { describe, expect, it } from "vitest";
import { acknowledgementLines, plainMessageText, type OutboundMessage } from "../intake.channels";
import { slackMessageText } from "../intake.slack";
import { teamsMessageText } from "../intake.teams";

const ack = (assignee: string | null, text = ""): OutboundMessage => ({
  id: "o1",
  kind: "acknowledgement",
  author: { kind: "mikegc" },
  text,
  requestSubject: "Review Acme NDA",
  acknowledgement: { subject: "Review Acme NDA", assignee },
  documents: [],
});

describe("MikeGC's acknowledgement to the requester", () => {
  it("thanks them and says who will pick the request up, without a link", () => {
    expect(plainMessageText(ack("Sam Lawyer"), { fromName: "Legal", signMember: true })).toBe(
      "Thanks, I've passed this to Legal. Sam Lawyer will pick it up.",
    );
    const unassigned = plainMessageText(ack(null), { fromName: "Legal", signMember: true });
    expect(unassigned).toBe("Thanks, I've passed this to Legal. Someone from the team will pick it up soon.");
    // The request's page is for the organization's members only.
    expect(unassigned).not.toMatch(/https?:\/\//);
  });

  it("runs straight into its questions, promising no one while it asks who should get it", () => {
    expect(
      acknowledgementLines(
        { subject: "Review Acme NDA", assignee: null },
        "One quick question so it gets to the right person:\nIs Acme a customer or a supplier?",
      ),
    ).toEqual([
      "Thanks, I've passed this to Legal. One quick question so it gets to the right person:",
      "Is Acme a customer or a supplier?",
    ]);
    expect(
      acknowledgementLines(
        { subject: "Review Acme NDA", assignee: "Sam Lawyer" },
        "A couple of things Legal will need before they start:\n1. Could you share the MSA?\n2. Who is signing?",
      ),
    ).toEqual([
      "Thanks, I've passed this to Legal. Sam Lawyer will pick it up. A couple of things Legal will need before they start:",
      "1. Could you share the MSA?",
      "2. Who is signing?",
    ]);
  });

  it("escapes the reviewer's name and the questions for each channel", () => {
    expect(slackMessageText(ack("Sam <Lawyer>", "One thing Legal will need before they start:\nA & B?"), { fromName: "Legal", customize: true })).toBe(
      "Thanks, I've passed this to Legal. Sam &lt;Lawyer&gt; will pick it up. One thing Legal will need before they start:\nA &amp; B?",
    );
    const teams = teamsMessageText(ack("Sam *Lawyer*"), { fromName: "Legal", files: [], withheld: [] });
    expect(teams).toContain("Sam \\*Lawyer\\* will pick it up.");
  });
});
