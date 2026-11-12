import { createHash } from "node:crypto";
import {
  ALLOWED_DOCUMENT_TYPES,
  contentTypeForDocumentType,
  documentSuffix,
} from "../../lib/documentTypes";
import { deleteFileBestEffort, uploadFile } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import type { ChannelLink, ChannelSource } from "./intake.channels";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  cleanText,
  type MailInboundPayload,
  type SkippedAttachment,
} from "./intake.inboundPayload";
import type { AutomationRow } from "./intake.settingsRow";

/**
 * What Outlook and Gmail share: reading a message's headers and body,
 * deciding whether it may be recorded, threading replies on Message-IDs,
 * staging attachments and the thread's address for replying.
 */

/** The most an email's attachments can add up to through the Gmail API. */
export const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
/** Exchange Online's default send limit, which a mailbox can raise. */
export const GRAPH_MAX_MESSAGE_BYTES = 35 * 1024 * 1024;

/** One header, as both providers list them. */
export type MailHeader = { name: string; value: string };

export function headerValue(headers: MailHeader[], name: string): string | null {
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value.trim() : null;
}

export function headerValues(headers: MailHeader[], name: string): string[] {
  return headers
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value.trim());
}

/** Out-of-office answers, other automatic replies and bulk or list mail. */
export function isAutomaticMail(headers: MailHeader[]): boolean {
  const autoSubmitted = headerValue(headers, "Auto-Submitted")?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const xAutoSubmitted = headerValue(headers, "X-Auto-Submitted")?.toLowerCase();
  if (xAutoSubmitted && xAutoSubmitted !== "no") return true;
  if (headerValue(headers, "X-Autoreply") !== null) return true;
  if (headerValue(headers, "X-Autorespond") !== null) return true;
  if (headerValue(headers, "List-Id") !== null) return true;
  const precedence = headerValue(headers, "Precedence")?.toLowerCase();
  return ["bulk", "auto_reply", "list", "junk"].includes(precedence ?? "");
}

/**
 * Whether the sender's domain, or a parent domain, is on the list. An empty
 * list accepts no one: mail is recorded only from domains an admin named.
 */
export function senderDomainAllowed(
  email: string | null,
  allowed: string[],
): boolean {
  const domain = email?.split("@").pop()?.toLowerCase();
  if (!domain) return false;
  return allowed.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Two domains in the same organization: one is the other or a subdomain of it. */
function aligned(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  const y = b.toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * Whether the receiving mail system authenticated the sender: the top
 * Authentication-Results header (the one the mailbox's own servers added)
 * reports dmarc=pass, or an SPF or DKIM pass for a domain aligned with the
 * From address's. A header a sender wrote further down is never read.
 */
export function senderAuthenticated(
  headers: MailHeader[],
  fromEmail: string | null,
): boolean {
  const fromDomain = fromEmail?.split("@").pop() ?? null;
  if (!fromDomain) return false;
  const results = headerValues(headers, "Authentication-Results")[0];
  if (!results) return false;
  const methods = results.split(";").slice(1).map((m) => m.trim().toLowerCase());
  // Exchange Online writes no authserv-id, so its first clause is a method.
  const first = results.split(";")[0]!.trim().toLowerCase();
  if (/^[a-z]+=/.test(first)) methods.unshift(first);
  const property = (clause: string, name: string) =>
    clause.match(new RegExp(`(?:^|\\s)${name.replace(".", "\\.")}=([^\\s;]+)`))?.[1] ?? null;
  for (const clause of methods) {
    const result = clause.match(/^([a-z]+)=([a-z]+)/);
    if (!result || result[2] !== "pass") continue;
    const method = result[1];
    if (method === "dmarc") {
      const from = property(clause, "header.from");
      if (!from || aligned(from, fromDomain)) return true;
    }
    if (method === "spf") {
      const mailFrom = property(clause, "smtp.mailfrom")?.split("@").pop();
      if (aligned(mailFrom, fromDomain)) return true;
    }
    if (method === "dkim") {
      const d = property(clause, "header.d") ?? property(clause, "header.i")?.split("@").pop();
      if (aligned(d, fromDomain)) return true;
    }
  }
  return false;
}

/** Addresses in a header such as To or Cc, lowercased. */
export function addressList(value: string | null): string[] {
  if (!value) return [];
  // A header is whatever its sender wrote. Each token is a whole run of
  // address characters, so the scan is linear however long a run is; an
  // address is a run with an "@" that is neither its first nor last
  // character. (Matching "…+@…+" directly rescans a long run without one
  // from every position.)
  const found = new Set<string>();
  for (const [token] of value.matchAll(/[^\s<>,;"']+/g)) {
    if (!token.slice(1, -1).includes("@")) continue;
    found.add(token.toLowerCase().replace(/[.)]+$/, ""));
    if (found.size === 50) break;
  }
  return [...found];
}

/**
 * The first mailbox in a header such as From, read the way mail systems
 * read it: an address inside a quoted display name or a comment is never
 * the address, so "<ceo@acme.test>" <intern@acme.test> is the intern. It is
 * the last <angle-addr> of the mailbox, or its bare address when there is
 * none. One pass over the header, however it is written.
 */
function firstMailbox(value: string): { email: string; name: [number, number] | null } | null {
  let start = 0;
  let quoted = false;
  let comment = 0;
  let open = -1;
  let angle: { email: string; at: number } | null = null;
  let token = "";
  let bare = "";
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (open >= 0) {
      if (c === ">") {
        angle = { email: value.slice(open + 1, i), at: open };
        open = -1;
      }
      if (c !== undefined) continue;
    }
    if (quoted || comment > 0) {
      if (c === "\\" && i + 1 < value.length) i++;
      else if (quoted && c === '"') quoted = false;
      else if (!quoted && c === "(") comment++;
      else if (!quoted && c === ")") comment--;
      if (c !== undefined) continue;
    }
    const end = c === undefined || c === ",";
    if (end || c === '"' || c === "(" || c === "<" || c === ":" || c === ";" || /\s/.test(c)) {
      if (token.includes("@")) bare = token;
      token = "";
    } else token += c;
    if (end) {
      const email = angle?.email ?? bare;
      if (email.includes("@")) return { email, name: angle ? [start, angle.at] : null };
      // An entry without an address, such as an empty group: the next one.
      if (c === undefined) return null;
      start = i + 1;
      angle = null;
      bare = "";
    } else if (c === '"') quoted = true;
    else if (c === "(") comment = 1;
    else if (c === "<") open = i;
  }
  return null;
}

/** "Jane Business" <jane@acme.test> as a name and address. */
export function parseMailbox(value: string | null): {
  name: string | null;
  email: string | null;
} {
  if (!value) return { name: null, email: null };
  const mailbox = firstMailbox(value);
  const email = mailbox?.email ?? null;
  // The display name is what comes before the address; angle brackets left
  // in it are dropped one by one, so no markup survives.
  const name = (mailbox?.name ? value.slice(...mailbox.name) : value)
    .replace(/[<>]/g, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  const normalized = email?.trim().toLowerCase() ?? null;
  return {
    email: normalized && /^[^@\s]+@[^@\s]+$/.test(normalized) && normalized.length <= 320 ? normalized : null,
    name: name && name.toLowerCase() !== normalized ? name.slice(0, 200) : null,
  };
}

/** Message-IDs in In-Reply-To and References, newest first, without brackets. */
export function referencedMessageIds(headers: MailHeader[]): string[] {
  const ids = [
    ...(headerValue(headers, "In-Reply-To") ?? "").matchAll(/<([^<>\s]+)>/g),
    ...[...(headerValue(headers, "References") ?? "").matchAll(/<([^<>\s]+)>/g)].reverse(),
  ].map((m) => m[1]!);
  return [...new Set(ids)].slice(0, 50);
}

/** A Message-ID as it is stored: without its brackets, hashed when long. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const id = value?.trim().replace(/^<|>$/g, "");
  if (!id) return null;
  return id.length <= 300
    ? id
    : `sha256:${createHash("sha256").update(id).digest("hex")}`;
}

const HIDDEN_ELEMENTS = new Set(["script", "style", "head"]);
const LINE_ENDING_ELEMENTS = /^(p|div|li|tr|h[1-6])$/;

/**
 * Readable text from an HTML-only email. Read in one pass from each "<" to
 * the next ">", so every tag goes, nested or broken ones such as
 * "<scr<b>ipt>" included, and what a script, style or head holds is dropped.
 */
export function htmlToText(html: string): string {
  const out: string[] = [];
  // The element whose content is being dropped, until it closes.
  let hidden: string | null = null;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (!hidden) out.push(open === -1 ? html.slice(at) : html.slice(at, open));
    if (open === -1) break;
    const close = html.indexOf(">", open + 1);
    // A tag that never ends: the rest is markup.
    if (close === -1) break;
    const tag = html.slice(open + 1, close).trim().toLowerCase();
    const closing = tag.startsWith("/");
    const name = (closing ? tag.slice(1) : tag).split(/[\s/]/)[0] ?? "";
    if (hidden) {
      if (closing && name === hidden) hidden = null;
    } else if (!closing && HIDDEN_ELEMENTS.has(name)) hidden = name;
    else if (name === "br" || (closing && LINE_ENDING_ELEMENTS.test(name)))
      out.push("\n");
    else if (!closing && name === "li") out.push("- ");
    at = close + 1;
  }
  return out
    .join("")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    // Trailing spaces go. Each run is matched whole and then kept or
    // dropped: /[ \t]+\n/ retries a long run with no line end after it from
    // every position, which is quadratic in a message's length.
    .replace(/[ \t]+/g, (run, at: number, all: string) =>
      all[at + run.length] === "\n" ? "" : run,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A reply without the history it quotes: "> " lines go, and so does
 * everything from a line such as "On 2 Nov 2026, Jane wrote:" or Outlook's
 * "-----Original Message-----" / "From: …" block.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(trimmed)) break;
    if (/^_{8,}$/.test(trimmed) && /^from:/i.test(lines[i + 1]?.trim() ?? "")) break;
    // "On … wrote:", which some clients wrap onto a second line.
    if (/^on\b.{0,200}\bwrote:$/i.test(trimmed)) break;
    if (
      /^on\b/i.test(trimmed) &&
      !/wrote:$/i.test(trimmed) &&
      /wrote:$/i.test(lines[i + 1]?.trim() ?? "") &&
      trimmed.length < 200
    )
      break;
    if (/^from:\s.+/i.test(trimmed) && /^(sent|date):\s/i.test(lines[i + 1]?.trim() ?? ""))
      break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fileName(value: string | undefined | null, index: number): string {
  const base = (value ?? "").split(/[\\/]/).pop() ?? "";
  const clean = cleanText(base)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(-255);
  return clean || `attachment-${index + 1}`;
}

/** An attachment as a provider lists it, read only if it is accepted. */
export type MailAttachmentSource = {
  name: string | null;
  contentType: string | null;
  size: number | null;
  /** Embedded in the body, such as a signature logo. */
  inline: boolean;
  read: () => Promise<Buffer | null>;
};

/**
 * Stage the attachments MikeGC will add: PDF, Word, Excel and PowerPoint,
 * up to 10 of 25 MB each. They wait in storage under the message's row until
 * it is handled, since the job runs later. The rest are listed as skipped,
 * except images embedded in the body, such as signature logos.
 */
export async function stageMailAttachments(
  orgId: string,
  inboundId: string,
  attachments: MailAttachmentSource[],
): Promise<Pick<MailInboundPayload, "attachments" | "skipped">> {
  const accepted: MailInboundPayload["attachments"] = [];
  const skipped: SkippedAttachment[] = [];
  try {
    for (const [index, attachment] of attachments.entries()) {
      const name = fileName(attachment.name, index);
      const fileType = documentSuffix(name);
      if (!ALLOWED_DOCUMENT_TYPES.has(fileType)) {
        const inline =
          attachment.inline &&
          (attachment.contentType ?? "").toLowerCase().startsWith("image/");
        if (!inline) skipped.push({ name, reason: "type" });
        continue;
      }
      if (attachment.size !== null && attachment.size > MAX_ATTACHMENT_BYTES + 3) {
        skipped.push({ name, reason: "size" });
        continue;
      }
      if (accepted.length >= MAX_ATTACHMENTS) {
        skipped.push({ name, reason: "count" });
        continue;
      }
      const bytes = await attachment.read();
      if (!bytes || bytes.length === 0) {
        skipped.push({ name, reason: "unreadable" });
        continue;
      }
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        skipped.push({ name, reason: "size" });
        continue;
      }
      const key = `intake-inbound/${orgId}/${inboundId}/${accepted.length}`;
      await uploadFile(
        key,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        contentTypeForDocumentType(fileType),
      );
      accepted.push({ name, file_type: fileType, size: bytes.length, key });
    }
  } catch (error) {
    await discardStaged(accepted.map((a) => a.key));
    throw error;
  }
  return { attachments: accepted, skipped };
}

export async function discardStaged(keys: string[]) {
  await Promise.all(
    keys.map((key) => deleteFileBestEffort(key, "intake-inbound-discard")),
  );
}

/** The channel an email arrived through. */
export const mailSource = (provider: "graph" | "gmail"): ChannelSource =>
  provider === "graph" ? "outlook" : "gmail";

/** An email thread's key on its link. */
export const mailThreadKey = (provider: "graph" | "gmail", thread: string) =>
  `${provider}:${thread}`;

/** The address of an email thread, as a reply to it is sent. */
export type MailAddress = {
  provider: "graph" | "gmail";
  mailbox: string;
  /** The requester. */
  to: string[];
  /** The other accepted addresses on the original mail. */
  cc: string[];
  subject: string;
  /** The provider's ID for the newest message in the thread. */
  reply_to_message_id: string;
  /** The provider's thread handle: Outlook's conversationId or Gmail's threadId. */
  thread: string;
  max_attachment_bytes: number;
  /**
   * Message-IDs to reply to when the thread has none recorded, as when
   * MikeGC answers a message without recording a request.
   */
  references?: string[];
};

/**
 * The thread a new email starts: replies go to its sender, cc the others
 * accepted. Mail that reached the mailbox without naming it in To or Cc (an
 * alias, a list, or a Bcc) is answered to its sender alone, so the others
 * never learn the intake address was sent a copy.
 */
export function mailThread(
  settings: AutomationRow,
  payload: MailInboundPayload,
): { source: ChannelSource; key: string; address: MailAddress } | null {
  const requester = payload.from.email;
  if (!requester) return null;
  const mailbox = payload.mailbox.toLowerCase();
  const allowed = settings.email_allowed_domains ?? [];
  const recipients = [...payload.to, ...payload.cc].map((a) => a.toLowerCase());
  const cc = (recipients.includes(mailbox) ? recipients : [])
    .filter(
      (a, i, all) =>
        a !== mailbox &&
        a !== requester &&
        all.indexOf(a) === i &&
        senderDomainAllowed(a, allowed),
    )
    .slice(0, 20);
  return {
    source: mailSource(payload.provider),
    key: mailThreadKey(payload.provider, payload.thread),
    address: {
      provider: payload.provider,
      mailbox: payload.mailbox,
      to: [requester],
      cc,
      subject: payload.subject ?? "Your request to Legal",
      reply_to_message_id: payload.provider_id,
      thread: payload.thread,
      max_attachment_bytes:
        payload.provider === "gmail" ? GMAIL_MAX_MESSAGE_BYTES : GRAPH_MAX_MESSAGE_BYTES,
    },
  };
}

export function mailAddress(link: ChannelLink): MailAddress {
  return link.address as unknown as MailAddress;
}

/** Remember Message-IDs seen or sent in a thread, for matching replies on them. */
export async function recordEmailMessageIds(
  db: Db,
  orgId: string,
  linkId: string,
  ids: string[],
): Promise<void> {
  // An answer that records no request has no link to remember them by.
  if (!linkId) return;
  const rows = ids
    .map((id) => normalizeMessageId(id))
    .filter((id): id is string => !!id)
    .map((message_id) => ({ org_id: orgId, link_id: linkId, message_id }));
  if (!rows.length) return;
  const { error } = await db
    .from("intake_email_message_ids")
    .upsert(rows, { onConflict: "org_id,message_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** The link whose thread one of these Message-IDs belongs to, newest first. */
export async function linkByMessageIds(
  db: Db,
  orgId: string,
  ids: string[],
): Promise<string | null> {
  const normalized = ids.map((id) => normalizeMessageId(id)).filter((id): id is string => !!id);
  if (!normalized.length) return null;
  const { data, error } = await db
    .from("intake_email_message_ids")
    .select("message_id, link_id")
    .eq("org_id", orgId)
    .in("message_id", normalized);
  if (error) throw error;
  const links = new Map(
    ((data ?? []) as { message_id: string; link_id: string }[]).map((r) => [r.message_id, r.link_id]),
  );
  // The newest Message-ID it answers decides, as the references are ordered.
  for (const id of normalized) {
    const link = links.get(id);
    if (link) return link;
  }
  return null;
}

/**
 * Whether a message in a request's thread counts as a reply: its sender is
 * authenticated and is the requester, someone copied on the thread, or
 * another address at the requester's domain.
 */
export function replyFromThread(
  address: MailAddress,
  from: string | null,
  authenticated: boolean,
): boolean {
  if (!from || !authenticated) return false;
  const sender = from.toLowerCase();
  if (address.to.includes(sender) || address.cc.includes(sender)) return true;
  const domain = sender.split("@").pop();
  return address.to.some((t) => t.split("@").pop() === domain);
}

/** "Re: <subject>", without stacking another "Re:". */
export function replySubject(subject: string): string {
  const clean = subject.replace(/[\r\n]+/g, " ").trim() || "Your request to Legal";
  return /^re:/i.test(clean) ? clean.slice(0, 900) : `Re: ${clean}`.slice(0, 900);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * The HTML version of an email's plain text, sent beside it: paragraphs at
 * blank lines and line breaks kept, so every mail app reflows the text to
 * its window. Some show plain text at a fixed width, which breaks MikeGC's
 * sentences mid-line. Everything is escaped: it is text, never markup.
 */
export function mailHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 1em">${p
          .replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)
          .replace(/\n/g, "<br>")}</p>`,
    );
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${paragraphs.join("")}</div>`;
}

/** The line every email from MikeGC ends with. */
export const MAIL_FOOTER = "Just reply to this email and Legal will see your answer.";

/**
 * The documents that fit in one email, in the order they were ticked, and
 * the rest, which are named in the body instead.
 */
export function fitAttachments<T extends { sizeBytes: number | null; leftOut?: boolean }>(
  documents: T[],
  limit: number,
  encodedSize: (bytes: number) => number,
): { attached: T[]; tooLarge: T[] } {
  const attached: T[] = [];
  const tooLarge: T[] = [];
  let total = 0;
  let full = false;
  for (const doc of documents) {
    if (doc.leftOut) continue;
    const size = encodedSize(doc.sizeBytes ?? 0);
    // Once one would pass the limit, it and every one after are named instead.
    if (full || total + size > limit) {
      full = true;
      tooLarge.push(doc);
    } else {
      total += size;
      attached.push(doc);
    }
  }
  return { attached, tooLarge };
}
