import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptedColumns } from "../intake.secrets";
import {
  gmailMailbox,
  gmailServiceAccount,
  noGmailAccountSentence,
  sharedGmailGrants,
  sharedGmailMailboxAllowed,
} from "../intake.gmail";

/**
 * The deployment's Gmail service account can act as any user of the domain
 * that delegated to it. INTAKE_GMAIL_SHARED_MAILBOXES is the only thing
 * that ties a workspace to the mailboxes it may use that account for, so
 * these cases are the workspace-to-mailbox authorization, end to end at the
 * function every read and send goes through.
 */
const acme = "3f2a1b4c-0000-4000-8000-00000000000a";
const globex = "9c1d2e3f-0000-4000-8000-00000000000b";
const DEPLOYMENT_KEY = JSON.stringify({
  client_email: "shared@deployment.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nshared\n-----END PRIVATE KEY-----\n",
  client_id: "111",
});
const OWN_KEY = JSON.stringify({
  client_email: "own@acme.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nown\n-----END PRIVATE KEY-----\n",
  client_id: "222",
});
const row = (orgId: string, mailbox: string | null, extra: Record<string, unknown> = {}) => ({
  org_id: orgId,
  email_provider: "gmail" as const,
  email_mailbox: mailbox,
  ...extra,
});
const ownKey = () => {
  const sealed = encryptedColumns("gmail_service_account_key", OWN_KEY);
  if (!sealed) throw new Error("the test's encryption secret isn't set");
  return sealed;
};
const saved = { ...process.env };

beforeEach(() => {
  process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = "a-test-secret-that-is-long-enough-000000";
  process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY = DEPLOYMENT_KEY;
  delete process.env.INTAKE_GMAIL_SHARED_MAILBOXES;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("who may use the deployment's Gmail account", () => {
  it("is nobody until the operator lists a grant", () => {
    expect(sharedGmailGrants(acme)).toEqual([]);
    expect(sharedGmailMailboxAllowed(acme, "intake@acme.com")).toBe(false);
    expect(gmailServiceAccount(row(acme, "intake@acme.com"))).toBeNull();
    expect(gmailMailbox(row(acme, "intake@acme.com"))).toBeNull();
    for (const empty of ["", "   ", ","]) {
      process.env.INTAKE_GMAIL_SHARED_MAILBOXES = empty;
      expect(gmailMailbox(row(acme, "intake@acme.com"))).toBeNull();
    }
  });
  it("is the granted organization, for the granted address only", () => {
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=intake@acme.com`;
    expect(gmailMailbox(row(acme, "intake@acme.com"))).toMatchObject({
      address: "intake@acme.com",
      account: { client_email: "shared@deployment.iam.gserviceaccount.com" },
    });
    // The same domain's other users: what delegation alone would allow.
    for (const other of ["ceo@acme.com", "intake2@acme.com", "intake+x@acme.com", "intake@acme.com.", "xintake@acme.com"])
      expect(gmailMailbox(row(acme, other)), other).toBeNull();
    // Another organization, for the very same mailbox.
    expect(gmailMailbox(row(globex, "intake@acme.com"))).toBeNull();
  });
  it("matches a granted domain exactly: no subdomain, parent or look-alike", () => {
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=@acme.com`;
    for (const inside of ["intake@acme.com", "CEO@ACME.com", " legal@acme.com "])
      expect(sharedGmailMailboxAllowed(acme, inside), inside).toBe(true);
    const outside = [
      "intake@sub.acme.com",
      "intake@acme.com.evil.example",
      "intake@evil-acme.com",
      "intake@notacme.com",
      "intake@acme.co",
      "intake@acme.comm",
      "intake@com",
      "acme.com@evil.example",
      "intake@acme.com@evil.example",
      "intake@evil.example?@acme.com".replace("?", ""), // the domain is what follows the LAST @
      "intake@acm\u0435.com", // a Cyrillic e
      "intake@acme.com\u0000.evil.example",
    ];
    for (const mailbox of outside) {
      const expected = mailbox === "intake@evil.example@acme.com";
      expect(sharedGmailMailboxAllowed(acme, mailbox), JSON.stringify(mailbox)).toBe(expected);
    }
    expect(sharedGmailMailboxAllowed(globex, "intake@acme.com")).toBe(false);
  });
  it("has no blanket grant: missing organization, missing mailbox and wildcards match nothing", () => {
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=@acme.com ${acme}=*@globex.com ${acme}=@*.com`;
    expect(sharedGmailMailboxAllowed(null, "intake@acme.com")).toBe(false);
    expect(sharedGmailMailboxAllowed(undefined, "intake@acme.com")).toBe(false);
    expect(sharedGmailMailboxAllowed("", "intake@acme.com")).toBe(false);
    expect(sharedGmailMailboxAllowed(acme, null)).toBe(false);
    expect(sharedGmailMailboxAllowed(acme, "")).toBe(false);
    expect(sharedGmailMailboxAllowed(acme, "intake@globex.com")).toBe(false);
    expect(sharedGmailMailboxAllowed(acme, "intake@other.com")).toBe(false);
    expect(gmailMailbox(row(acme, null))).toBeNull();
  });
  it("reads the list afresh, so a grant withdrawn stops the mailbox and one restored resumes it", () => {
    const mailbox = row(acme, "intake@acme.com");
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=intake@acme.com`;
    expect(gmailMailbox(mailbox)).not.toBeNull();
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${globex}=intake@acme.com`;
    expect(gmailMailbox(mailbox)).toBeNull();
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${globex}=intake@acme.com,${acme.toUpperCase()}=INTAKE@acme.com`;
    expect(gmailMailbox(mailbox)).not.toBeNull();
  });
});

describe("an organization's own Gmail key", () => {
  it("is used for any mailbox it connects, with or without a grant", () => {
    const own = row(acme, "anyone@acme.com", ownKey());
    expect(gmailMailbox(own)).toMatchObject({
      account: { client_email: "own@acme.iam.gserviceaccount.com" },
    });
    // A grant never swaps the organization's own account for the shared one.
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=@acme.com`;
    expect(gmailServiceAccount(own)).toMatchObject({ client_email: "own@acme.iam.gserviceaccount.com" });
  });
  it("is never replaced by the shared account when it can no longer be read", () => {
    process.env.INTAKE_GMAIL_SHARED_MAILBOXES = `${acme}=@acme.com`;
    const unreadable = row(acme, "intake@acme.com", {
      gmail_service_account_key_encrypted: "not-the-ciphertext",
      gmail_service_account_key_iv: "AAAA",
      gmail_service_account_key_tag: "AAAA",
    });
    expect(gmailServiceAccount(unreadable)).toBeNull();
    expect(gmailMailbox(unreadable)).toBeNull();
  });
});

describe("what an admin is told", () => {
  it("names the shared account's refusal only when that is the reason", () => {
    expect(noGmailAccountSentence(row(acme, "intake@acme.com"))).toMatch(/own service account/);
    // With the organization's own key saved, or no deployment key, it is another matter.
    expect(noGmailAccountSentence(row(acme, "intake@acme.com", ownKey()))).toBeNull();
    delete process.env.INTAKE_GMAIL_SERVICE_ACCOUNT_KEY;
    expect(noGmailAccountSentence(row(acme, "intake@acme.com"))).toBeNull();
  });
});
