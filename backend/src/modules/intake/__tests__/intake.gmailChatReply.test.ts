import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  JWT: class {
    getAccessToken() {
      return Promise.resolve({ token: "gmail-token" });
    }
  },
}));

import type { Db } from "../../../lib/supabase";
import type { AutomationRow } from "../intake.settingsRow";
import { gmailAdapter, gmailMarkRecorded } from "../intake.gmail";
import { mailHtml } from "../intake.mail";

/** A database the reply must never touch: it records no request or link. */
const untouchedDb = new Proxy({} as Db, {
  get() {
    throw new Error("A chat reply by email must not touch the database.");
  },
});

const org = "00000000-0000-4000-8000-000000000001";
const settings = {
  org_id: org,
  email_enabled: true,
  email_provider: "gmail",
  email_mailbox: "intake@firm.test",
  gmail_service_account_key_encrypted: null,
} as unknown as AutomationRow;

describe("Gmail: MikeGC's answer to an email that isn't a request", () => {
  let sent: { raw: string; threadId: string } | null;
  beforeEach(() => {
    process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "mikegc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
      client_id: "1234567890",
    });
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${org}=intake@firm.test`;
    sent = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/messages/send")) {
          sent = JSON.parse(String(init?.body));
          return Response.json({ id: "sent-1" });
        }
        if (target.includes("/messages/sent-1"))
          return Response.json({ payload: { headers: [{ name: "Message-ID", value: "<sent-1@mail.gmail.com>" }] } });
        return Response.json({}, { status: 404 });
      }),
    );
  });
  afterEach(() => {
    delete process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY;
    delete process.env.INTAKE_GMAIL_SHARED_MAILBOXES;
    vi.unstubAllGlobals();
  });

  it("replies in the email's thread, to the message itself, without a link", async () => {
    const result = await gmailAdapter.deliver(
      {
        db: untouchedDb,
        settings,
        fromName: "Legal",
        readDocument: () => Promise.reject(new Error("no documents")),
        saveProgress: () => Promise.resolve(),
      },
      {
        id: "",
        org_id: "org-1",
        request_id: "",
        source: "gmail",
        thread_key: "gmail:t-1",
        address: {
          provider: "gmail",
          mailbox: "intake@firm.test",
          to: ["pat@partner.test"],
          cc: [],
          subject: "How are you",
          reply_to_message_id: "gm-3",
          thread: "t-1",
          max_attachment_bytes: 25 * 1024 * 1024,
          references: ["<hello@partner.test>"],
        },
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "answer",
        author: { kind: "mikegc" },
        text: "Hi! Tell me what you need from Legal and I'll pass it on.",
        requestSubject: "",
        documents: [],
      },
      null,
    );
    // Kept as MikeGC normalises Message-IDs, without angle brackets.
    expect(result.externalId).toBe("sent-1@mail.gmail.com");
    expect(sent?.threadId).toBe("t-1");
    const raw = Buffer.from(sent!.raw, "base64url").toString("utf8");
    // Threaded on the requester's side too, as a reply to their message.
    expect(raw).toContain("In-Reply-To: <hello@partner.test>");
    expect(raw).toContain("References: <hello@partner.test>");
    expect(raw).toMatch(/^Subject: Re: How are you/m);
    expect(raw).toMatch(/^To: pat@partner\.test/m);
    expect(raw).toContain("Hi! Tell me what you need from Legal and I'll pass it on.");
    // Plain text and HTML: mail apps reflow the HTML, so no mid-sentence breaks.
    expect(raw).toMatch(/^Content-Type: multipart\/alternative/m);
    expect(raw).toMatch(/^Content-Type: text\/plain/m);
    expect(raw).toMatch(/^Content-Type: text\/html/m);
  });
});

describe("the HTML version of MikeGC's emails", () => {
  it("keeps paragraphs and line breaks, and escapes everything as text", () => {
    const html = mailHtml("Hi <Pat> & co,\nline two\n\n\nNext paragraph.\r\n");
    expect(html).toContain('<p style="margin:0 0 1em">Hi &lt;Pat&gt; &amp; co,<br>line two</p>');
    expect(html).toContain('<p style="margin:0 0 1em">Next paragraph.</p>');
    expect(html).not.toContain("<Pat>");
  });
});

describe("Gmail: labelling a recorded email", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("looks the label up again after its remembered id stops working", async () => {
    const mailbox = {
      address: "labels@firm.test",
      account: { client_email: "mikegc@project.iam.gserviceaccount.com", private_key: "key", client_id: "1" },
    } as Parameters<typeof gmailMarkRecorded>[0];
    // The label is deleted and made again in Gmail between two emails.
    let current = "Label_1";
    const applied: string[] = [];
    let lists = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/labels")) {
          lists += 1;
          return Response.json({ labels: [{ id: current, name: "MikeGC" }] });
        }
        const [label] = (JSON.parse(String(init?.body)) as { addLabelIds: string[] }).addLabelIds;
        if (label !== current) return Response.json({}, { status: 400 });
        applied.push(label!);
        return Response.json({});
      }),
    );
    await gmailMarkRecorded(mailbox, "m1");
    await gmailMarkRecorded(mailbox, "m2");
    expect(lists).toBe(1);
    current = "Label_2";
    await gmailMarkRecorded(mailbox, "m3"); // Fails quietly, and forgets Label_1.
    await gmailMarkRecorded(mailbox, "m4");
    expect(applied).toEqual(["Label_1", "Label_1", "Label_2"]);
  });
});
