import { describe, expect, it } from "vitest";
import {
  addressList,
  fitAttachments,
  isAutomaticMail,
  normalizeMessageId,
  parseMailbox,
  referencedMessageIds,
  replyFromThread,
  replySubject,
  senderAuthenticated,
  stripQuotedReply,
  type MailAddress,
} from "../intake.mail";
import { buildMime } from "../intake.gmail";
import { encodedSize, mailBody } from "../intake.outlook";

const headers = (pairs: [string, string][]) => pairs.map(([name, value]) => ({ name, value }));

describe("authenticating the sender", () => {
  it("accepts a DMARC pass, or an SPF or DKIM pass aligned with From", () => {
    expect(
      senderAuthenticated(
        headers([["Authentication-Results", "mx.google.com; dkim=pass header.i=@acme.test; spf=pass smtp.mailfrom=jane@acme.test; dmarc=pass (p=NONE) header.from=acme.test"]]),
        "jane@acme.test",
      ),
    ).toBe(true);
    // Exchange Online writes no authserv-id.
    expect(
      senderAuthenticated(
        headers([["Authentication-Results", "spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=bounce.acme.test; dkim=none; dmarc=fail action=none header.from=acme.test"]]),
        "jane@acme.test",
      ),
    ).toBe(true);
    expect(
      senderAuthenticated(
        headers([["Authentication-Results", "mx.google.com; dkim=pass header.d=acme.test; spf=softfail; dmarc=none"]]),
        "jane@eu.acme.test",
      ),
    ).toBe(true);
  });
  it("refuses a forged From, unaligned passes and a header added further down", () => {
    // SPF passed for the sender's own domain, not the From address's.
    expect(
      senderAuthenticated(
        headers([["Authentication-Results", "mx.google.com; spf=pass smtp.mailfrom=attacker@evil.test; dkim=pass header.d=evil.test; dmarc=fail header.from=acme.test"]]),
        "ceo@acme.test",
      ),
    ).toBe(false);
    // Only the top header, which the receiving servers added, counts.
    expect(
      senderAuthenticated(
        headers([
          ["Authentication-Results", "mx.google.com; spf=fail; dkim=none; dmarc=fail header.from=acme.test"],
          ["Authentication-Results", "attacker.test; dmarc=pass header.from=acme.test"],
        ]),
        "ceo@acme.test",
      ),
    ).toBe(false);
    expect(senderAuthenticated([], "jane@acme.test")).toBe(false);
    expect(
      senderAuthenticated(headers([["Authentication-Results", "mx.google.com; dmarc=pass header.from=acme.test"]]), null),
    ).toBe(false);
  });
});

describe("reading email", () => {
  it("cuts the history a reply quotes", () => {
    expect(
      stripQuotedReply("Acme is a customer.\n\nOn Mon, 2 Nov 2026 at 09:14, Legal <intake@firm.test> wrote:\n> Is Acme a customer?"),
    ).toBe("Acme is a customer.");
    expect(
      stripQuotedReply("Yes.\n\nOn Mon, 2 Nov 2026 at 09:14, Legal\n<intake@firm.test> wrote:\n> Is it?"),
    ).toBe("Yes.");
    expect(stripQuotedReply("Supplier.\r\n\r\n-----Original Message-----\r\nFrom: Legal")).toBe("Supplier.");
    expect(stripQuotedReply("Supplier.\n\nFrom: Legal <intake@firm.test>\nSent: Monday\nTo: Jane")).toBe("Supplier.");
    expect(stripQuotedReply("> quoted\nAnswer")).toBe("Answer");
  });
  it("reads the Message-IDs a reply answers, newest first", () => {
    expect(
      referencedMessageIds(
        headers([
          ["In-Reply-To", "<c@mail.test>"],
          ["References", "<a@mail.test> <b@mail.test>\r\n <c@mail.test>"],
        ]),
      ),
    ).toEqual(["c@mail.test", "b@mail.test", "a@mail.test"]);
    expect(normalizeMessageId("<abc@mail.test>")).toBe("abc@mail.test");
    expect(normalizeMessageId("x".repeat(400))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("reads addresses and names", () => {
    expect(addressList('"Ana" <Ana@Acme.test>, ben@acme.test; ana@acme.test')).toEqual([
      "ana@acme.test",
      "ben@acme.test",
    ]);
    expect(parseMailbox('"Jane Business" <Jane@Acme.test>')).toEqual({ name: "Jane Business", email: "jane@acme.test" });
    expect(parseMailbox("jane@acme.test")).toEqual({ name: null, email: "jane@acme.test" });
  });
  it("never takes an address from a From header's display name or comment", () => {
    const email = (value: string) => parseMailbox(value).email;
    expect(email('"<ceo@acme.test>" <intern@acme.test>')).toBe("intern@acme.test");
    expect(email('"ceo@acme.test \\" <ceo@acme.test>" <intern@acme.test>')).toBe("intern@acme.test");
    expect(email("(<ceo@acme.test>) intern@acme.test")).toBe("intern@acme.test");
    expect(email("intern@acme.test (CEO <ceo@acme.test>)")).toBe("intern@acme.test");
    expect(email('"Doe, Jane" <jane@acme.test>, ben@acme.test')).toBe("jane@acme.test");
    expect(email('"only <ceo@acme.test>"')).toBeNull();
    // A long hostile header is read in one pass.
    const started = performance.now();
    expect(email(`${'"('.repeat(30_000)}<${"a".repeat(60_000)}`)).toBeNull();
    expect(email(`${"<a@b.test> ".repeat(20_000)}x`)).toBe("a@b.test");
    expect(performance.now() - started).toBeLessThan(1_000);
  });
  it("reads a hostile header in linear time", () => {
    // Either of these took seconds: a long run with no "@" was rescanned
    // from every position, and duplicates were found by indexOf.
    const started = performance.now();
    expect(addressList("a".repeat(60_000))).toEqual([]);
    const many = Array.from({ length: 30_000 }, (_, i) => `u${i % 60}@x.test`).join(", ");
    expect(addressList(many)).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(addressList("@a.test, a@, <@>, x@y.test.), b@c@d.test")).toEqual(["x@y.test", "b@c@d.test"]);
  });
  it("knows automatic mail", () => {
    expect(isAutomaticMail(headers([["Auto-Submitted", "auto-replied"]]))).toBe(true);
    expect(isAutomaticMail(headers([["X-Auto-Submitted", "auto-generated"]]))).toBe(true);
    expect(isAutomaticMail(headers([["List-Id", "<news.acme.test>"]]))).toBe(true);
    expect(isAutomaticMail(headers([["Auto-Submitted", "no"]]))).toBe(false);
  });
});

describe("replies in a request's thread", () => {
  const address: MailAddress = {
    provider: "gmail",
    mailbox: "intake@firm.test",
    to: ["ana@acme.test"],
    cc: ["ben@partner.test"],
    subject: "NDA",
    reply_to_message_id: "m1",
    thread: "t1",
    max_attachment_bytes: 25 * 1024 * 1024,
  };
  it("counts the requester, those copied and their colleagues, when authenticated", () => {
    expect(replyFromThread(address, "ana@acme.test", true)).toBe(true);
    expect(replyFromThread(address, "ben@partner.test", true)).toBe(true);
    expect(replyFromThread(address, "carl@acme.test", true)).toBe(true);
    expect(replyFromThread(address, "eve@evil.test", true)).toBe(false);
    expect(replyFromThread(address, "ana@acme.test", false)).toBe(false);
  });
  it("answers on the thread's subject once", () => {
    expect(replySubject("NDA with Acme")).toBe("Re: NDA with Acme");
    expect(replySubject("RE: NDA")).toBe("RE: NDA");
  });
  it("attaches documents in order until the next would pass the limit", () => {
    const docs = [
      { name: "a", sizeBytes: 10 },
      { name: "b", sizeBytes: 60 },
      { name: "c", sizeBytes: 5 },
    ];
    const { attached, tooLarge } = fitAttachments(docs, 50, (n) => n);
    expect(attached.map((d) => d.name)).toEqual(["a"]);
    expect(tooLarge.map((d) => d.name)).toEqual(["b", "c"]);
    // Base64 grows a file by a third.
    expect(encodedSize(3_000_000)).toBeGreaterThan(4_000_000);
  });
  it("names what was too large and how to answer", () => {
    const body = mailBody(
      {
        id: "o1",
        kind: "answer",
        author: { kind: "member", name: "Emma Chen" },
        text: "Approved with the changes attached.",
        requestSubject: "NDA",
        documents: [],
      },
      { fromName: "Legal", signMember: true, tooLarge: ["big.pdf"], withheld: [] },
    );
    expect(body).toBe(
      "Emma Chen (Legal):\nApproved with the changes attached.\n\n" +
        "big.pdf was too large to email, so ask Legal for a copy.\n\n" +
        "Just reply to this email and Legal will see your answer.",
    );
  });
});

describe("building a Gmail reply", () => {
  it("threads on our own headers and marks MikeGC's own messages", async () => {
    const raw = (
      await buildMime({
        from: { name: "Emma Chen via Legal", address: "intake@firm.test" },
        to: ["ana@acme.test"],
        cc: ["ben@acme.test"],
        subject: "Re: NDA",
        messageId: "o1@mikegc",
        inReplyTo: "c@mail.test",
        references: ["a@mail.test", "c@mail.test"],
        autoSubmitted: true,
        outboundId: "o1",
        text: "Which entity is signing?",
        attachments: [{ filename: "nda.docx", content: Buffer.from("PK") }],
      })
    ).toString("utf8");
    expect(raw).toContain("From: Emma Chen via Legal <intake@firm.test>");
    expect(raw).toContain("To: ana@acme.test");
    expect(raw).toContain("Cc: ben@acme.test");
    expect(raw).toContain("Subject: Re: NDA");
    expect(raw).toContain("Message-ID: <o1@mikegc>");
    expect(raw).toContain("In-Reply-To: <c@mail.test>");
    expect(raw).toContain("References: <a@mail.test> <c@mail.test>");
    expect(raw).toContain("Auto-Submitted: auto-generated");
    // Header names are case-insensitive; MailComposer writes this one its own way.
    expect(raw).toMatch(/^X-MikeGC-Outbound: o1\r?$/im);
    expect(raw).toMatch(/filename="?nda\.docx"?/);
  });
});
