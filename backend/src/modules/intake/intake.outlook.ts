import {
  ChannelDeliveryError,
  plainMessageText,
  type ChannelAdapter,
  type OutboundMessage,
} from "./intake.channels";
import {
  MAIL_FOOTER,
  fitAttachments,
  mailAddress,
  mailHtml,
  parseMailbox,
  recordEmailMessageIds,
  type MailAttachmentSource,
  type MailHeader,
} from "./intake.mail";
import {
  GRAPH_API,
  GRAPH_SCOPE,
  MicrosoftApiError,
  isMicrosoftUploadUrl,
  microsoftFetch,
  microsoftResponse,
  microsoftToken,
  readLimited,
  uploadInSession,
} from "./intake.microsoft";
import { MAX_ATTACHMENT_BYTES } from "./intake.inboundPayload";
import { graphClientSecret } from "./intake.secrets";
import type { AutomationRow } from "./intake.settingsRow";

/**
 * Outlook through Microsoft Graph: the organization's intake mailbox (a
 * shared mailbox, ideally), read and replied from with the organization's
 * own Entra app by client credentials, which Exchange RBAC for Applications
 * limits to that mailbox. Replies thread natively and land in Sent Items.
 */

/** A single-value extended property that names an email's outbox row. */
const OUTBOUND_PROPERTY =
  "String {00020329-0000-0000-C000-000000000046} Name MikeGCOutboundId";
/** Attachments larger than this go up in an upload session. */
const SIMPLE_ATTACHMENT_BYTES = 3 * 1024 * 1024;
/** Graph's message subscriptions last just under seven days; MikeGC renews at three. */
export const GRAPH_SUBSCRIPTION_DAYS = 3;

const CREDENTIALS_REFUSED =
  "Microsoft didn't accept the intake mailbox's app credentials. An admin can check the tenant ID, client ID and secret in Intake settings.";
const MAILBOX_REFUSED =
  "Microsoft refused MikeGC access to the intake mailbox. Check the app's Mail.ReadWrite and Mail.Send permissions and its Exchange RBAC scope.";

export type GraphCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
};

export function graphCredentials(settings: AutomationRow): GraphCredentials {
  const secret = graphClientSecret(settings);
  if (!settings.graph_tenant_id || !settings.graph_client_id || !secret || !settings.email_mailbox)
    throw new MicrosoftApiError({
      status: 0,
      code: "not_configured",
      permanent: true,
      sentence: "The intake mailbox isn't connected. An admin can connect it in Intake settings.",
    });
  return {
    tenantId: settings.graph_tenant_id,
    clientId: settings.graph_client_id,
    clientSecret: secret,
    mailbox: settings.email_mailbox,
  };
}

async function token(credentials: GraphCredentials) {
  return (
    await microsoftToken(
      {
        tenantId: credentials.tenantId,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        scope: GRAPH_SCOPE,
      },
      { sentence: CREDENTIALS_REFUSED },
    )
  ).token;
}

const mailboxUrl = (mailbox: string) => `${GRAPH_API}/users/${encodeURIComponent(mailbox)}`;

/** Check that the app can open the mailbox's Inbox. */
export async function checkGraphMailbox(credentials: GraphCredentials): Promise<void> {
  await microsoftFetch(`${mailboxUrl(credentials.mailbox)}/mailFolders/inbox?$select=id`, {
    token: await token(credentials),
    refused: MAILBOX_REFUSED,
    missing: "Microsoft couldn't find that mailbox. Check the intake address.",
  });
}

type GraphRecipient = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  isDraft?: boolean;
  hasAttachments?: boolean;
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  internetMessageHeaders?: { name?: string; value?: string }[];
  body?: { content?: string; contentType?: string };
  uniqueBody?: { content?: string; contentType?: string };
};

/** A received email as both providers' readers hand it on. */
export type ReadMail = {
  provider: "graph" | "gmail";
  providerId: string;
  internetMessageId: string | null;
  thread: string;
  headers: MailHeader[];
  from: { name: string | null; email: string | null };
  to: string[];
  cc: string[];
  subject: string | null;
  date: string;
  /** The whole body as text. */
  text: string;
  /** Only what this message adds to its thread, for a reply. */
  newText: string;
  attachments: MailAttachmentSource[];
  isDraft: boolean;
};

const address = (r: GraphRecipient | undefined) => r?.emailAddress?.address?.toLowerCase() ?? null;

/** One received email with what recording it needs. */
export async function graphReadMessage(
  credentials: GraphCredentials,
  messageId: string,
): Promise<ReadMail | null> {
  const t = await token(credentials);
  const base = `${mailboxUrl(credentials.mailbox)}/messages/${encodeURIComponent(messageId)}`;
  let message: GraphMessage;
  try {
    message = await microsoftFetch<GraphMessage>(
      `${base}?$select=id,internetMessageId,conversationId,subject,isDraft,hasAttachments,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,internetMessageHeaders,body,uniqueBody`,
      { token: t, headers: { Prefer: 'outlook.body-content-type="text"' }, refused: MAILBOX_REFUSED },
    );
  } catch (error) {
    // Moved or deleted since it arrived.
    if (error instanceof MicrosoftApiError && error.status === 404) return null;
    throw error;
  }
  const attachments: MailAttachmentSource[] = [];
  if (message.hasAttachments) {
    const list = await microsoftFetch<{
      value?: { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean; "@odata.type"?: string }[];
    }>(`${base}/attachments?$select=id,name,contentType,size,isInline`, { token: t, refused: MAILBOX_REFUSED });
    for (const a of (list.value ?? []).slice(0, 50)) {
      if (a["@odata.type"] && a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
      attachments.push({
        name: a.name ?? null,
        contentType: a.contentType ?? null,
        size: typeof a.size === "number" ? a.size : null,
        inline: !!a.isInline,
        read: async () => {
          const response = await microsoftResponse(
            `${base}/attachments/${encodeURIComponent(a.id)}/$value`,
            { token: t, long: true, refused: MAILBOX_REFUSED },
          );
          const bytes = await readLimited(response, MAX_ATTACHMENT_BYTES);
          return bytes ? Buffer.from(bytes) : null;
        },
      });
    }
  }
  const headers = (message.internetMessageHeaders ?? []).flatMap((h) =>
    h.name && typeof h.value === "string" ? [{ name: h.name, value: h.value }] : [],
  );
  const from = message.from?.emailAddress
    ? {
        email: address(message.from),
        name: message.from.emailAddress.name?.trim() || null,
      }
    : parseMailbox(headers.find((h) => h.name.toLowerCase() === "from")?.value ?? null);
  return {
    provider: "graph",
    providerId: message.id,
    internetMessageId: message.internetMessageId ?? null,
    thread: message.conversationId ?? message.id,
    headers,
    from,
    to: (message.toRecipients ?? []).flatMap((r) => (address(r) ? [address(r)!] : [])),
    cc: (message.ccRecipients ?? []).flatMap((r) => (address(r) ? [address(r)!] : [])),
    subject: message.subject?.trim() || null,
    date: message.sentDateTime ?? message.receivedDateTime ?? new Date().toISOString(),
    text: message.body?.content ?? "",
    newText: message.uniqueBody?.content ?? message.body?.content ?? "",
    attachments,
    isDraft: !!message.isDraft,
  };
}

/** A page of the Inbox's changes: new message IDs, and where to read on from. */
export async function graphDelta(
  credentials: GraphCredentials,
  from: string | null,
  /** Where a new read starts; by default now, so earlier mail isn't recorded. */
  since: Date = new Date(),
): Promise<{ ids: string[]; deltaLink: string }> {
  const t = await token(credentials);
  let next: string | null =
    from ??
    `${mailboxUrl(credentials.mailbox)}/mailFolders('Inbox')/messages/delta?$select=id&$filter=${encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)}`;
  const ids: string[] = [];
  for (let page = 0; page < 50 && next; page++) {
    const data: {
      value?: { id?: string; "@removed"?: unknown }[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    } = await microsoftFetch(next, { token: t, refused: MAILBOX_REFUSED });
    for (const m of data.value ?? []) if (m.id && !m["@removed"]) ids.push(m.id);
    const delta = data["@odata.deltaLink"];
    if (typeof delta === "string" && delta.startsWith(GRAPH_API))
      return { ids: [...new Set(ids)], deltaLink: delta };
    const link = data["@odata.nextLink"];
    next = typeof link === "string" && link.startsWith(GRAPH_API) ? link : null;
  }
  // More than one read holds: the next one carries on from this page's link,
  // which Graph accepts as a delta link, so a long backlog still finishes.
  if (next) return { ids: [...new Set(ids)], deltaLink: next };
  throw new MicrosoftApiError({
    status: 0,
    code: "delta_incomplete",
    permanent: false,
    sentence: "MikeGC couldn't finish reading the mailbox. It will try again.",
  });
}

/** Subscribe to new mail in the Inbox, renewed before it runs out. */
export async function graphSubscribe(
  credentials: GraphCredentials,
  args: { notificationUrl: string; clientState: string },
): Promise<{ id: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + GRAPH_SUBSCRIPTION_DAYS * 86_400_000).toISOString();
  const created = await microsoftFetch<{ id?: string; expirationDateTime?: string }>(
    `${GRAPH_API}/subscriptions`,
    {
      token: await token(credentials),
      json: {
        changeType: "created",
        notificationUrl: args.notificationUrl,
        lifecycleNotificationUrl: args.notificationUrl,
        resource: `users/${credentials.mailbox}/mailFolders('Inbox')/messages`,
        expirationDateTime: expiresAt,
        clientState: args.clientState,
      },
      refused: MAILBOX_REFUSED,
    },
  );
  if (!created?.id)
    throw new MicrosoftApiError({ status: 0, code: "invalid_response", permanent: false, sentence: "Microsoft sent an answer MikeGC couldn't read." });
  return { id: created.id, expiresAt: created.expirationDateTime ?? expiresAt };
}

export async function graphRenew(
  credentials: GraphCredentials,
  subscriptionId: string,
): Promise<string> {
  const expiresAt = new Date(Date.now() + GRAPH_SUBSCRIPTION_DAYS * 86_400_000).toISOString();
  const renewed = await microsoftFetch<{ expirationDateTime?: string }>(
    `${GRAPH_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      token: await token(credentials),
      method: "PATCH",
      json: { expirationDateTime: expiresAt },
      refused: MAILBOX_REFUSED,
    },
  );
  return renewed?.expirationDateTime ?? expiresAt;
}

export async function graphUnsubscribe(credentials: GraphCredentials, subscriptionId: string) {
  await microsoftFetch(`${GRAPH_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    token: await token(credentials),
    method: "DELETE",
  }).catch(() => undefined);
}

/** Mark a recorded email with the "MikeGC" category, so the mailbox shows it. */
export async function graphMarkRecorded(credentials: GraphCredentials, messageId: string) {
  try {
    const t = await token(credentials);
    const url = `${mailboxUrl(credentials.mailbox)}/messages/${encodeURIComponent(messageId)}`;
    // Keep the categories the mailbox already gave it.
    const current = await microsoftFetch<{ categories?: unknown }>(`${url}?$select=categories`, { token: t });
    const categories = Array.isArray(current?.categories)
      ? current.categories.filter((c): c is string => typeof c === "string")
      : [];
    if (categories.includes("MikeGC")) return;
    await microsoftFetch(url, {
      token: t,
      method: "PATCH",
      json: { categories: [...categories, "MikeGC"] },
    });
  } catch {
    // A missing category never stops recording.
  }
}

/** A test email from the intake mailbox to the admin connecting it. */
export async function graphSendTest(credentials: GraphCredentials, to: string, fromName: string) {
  await microsoftFetch(`${mailboxUrl(credentials.mailbox)}/sendMail`, {
    token: await token(credentials),
    json: {
      message: {
        subject: "MikeGC is connected to the intake mailbox",
        body: {
          contentType: "HTML",
          content: mailHtml(
            "MikeGC can read and send from this intake mailbox. Requests emailed here will be recorded in Intake.",
          ),
        },
        from: { emailAddress: { address: credentials.mailbox, name: fromName } },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    },
    refused: MAILBOX_REFUSED,
  });
}

const propertyFilter = (outboundId: string) =>
  `singleValueExtendedProperties/Any(ep: ep/id eq '${OUTBOUND_PROPERTY}' and ep/value eq '${outboundId}')`;

async function findByOutbound(
  t: string,
  mailbox: string,
  folder: "sentitems" | "drafts",
  outboundId: string,
) {
  const data = await microsoftFetch<{ value?: { id: string; internetMessageId?: string }[] }>(
    `${mailboxUrl(mailbox)}/mailFolders('${folder}')/messages?$filter=${encodeURIComponent(propertyFilter(outboundId))}&$select=id,internetMessageId&$top=5`,
    { token: t, refused: MAILBOX_REFUSED },
  );
  return data?.value ?? [];
}

/** The email's body: the message, any documents too large to attach, the footer. */
export function mailBody(
  message: OutboundMessage,
  options: { fromName: string; signMember: boolean; tooLarge: string[]; withheld: string[] },
): string {
  const parts = [plainMessageText(message, { fromName: options.fromName, signMember: options.signMember })];
  if (options.tooLarge.length)
    parts.push(
      options.tooLarge.map((name) => `${name} was too large to email, so ask Legal for a copy.`).join("\n"),
    );
  if (options.withheld.length)
    parts.push(`I couldn't attach ${options.withheld.join(", ")}, so ask Legal for a copy.`);
  parts.push(MAIL_FOOTER);
  return parts.filter(Boolean).join("\n\n");
}

/** Base64 grows a file by a third, plus line breaks. */
export const encodedSize = (bytes: number) => Math.ceil(bytes / 3) * 4 * (78 / 76);

function outlookError(error: unknown): Error {
  if (!(error instanceof MicrosoftApiError)) return error as Error;
  if (error.code === "ErrorInvalidRecipients" || error.code === "ErrorRecipientNotFound")
    return new ChannelDeliveryError("The email couldn't be sent to the requester's address.", true);
  if (error.status === 404)
    return new ChannelDeliveryError("The email MikeGC replies to was deleted from the intake mailbox.", true);
  if (error.code === "ErrorMessageSizeExceeded")
    return new ChannelDeliveryError("The email was too large for the intake mailbox to send.", true);
  return new ChannelDeliveryError(error.sentence, error.permanent);
}

/**
 * The Outlook adapter: a reply-all to the newest message in the thread,
 * addressed to the requester and the others on the thread (never the
 * mailbox), with the documents that fit attached and the rest named.
 * Exchange sets the threading headers itself and accepts only X- headers, so
 * MikeGC's own messages carry X-Auto-Submitted, and the outbox ID is an
 * extended property that a retry looks for in Sent Items.
 */
export const outlookAdapter: ChannelAdapter = {
  source: "outlook",
  async deliver(ctx, link, message, delivered) {
    if (delivered) return { externalId: delivered, documents: message.documents };
    if (!ctx.settings.email_enabled || ctx.settings.email_provider !== "graph")
      throw new ChannelDeliveryError("The intake mailbox isn't connected, so MikeGC can't email the requester.", true);
    try {
      const credentials = graphCredentials(ctx.settings);
      const thread = mailAddress(link);
      const t = await token(credentials);
      // A draft left by an attempt that stopped before sending.
      for (const draft of await findByOutbound(t, credentials.mailbox, "drafts", message.id))
        await microsoftFetch(`${mailboxUrl(credentials.mailbox)}/messages/${encodeURIComponent(draft.id)}`, {
          token: t,
          method: "DELETE",
        }).catch(() => undefined);
      const documents = message.documents.map((d) => ({ ...d }));
      const { attached, tooLarge } = fitAttachments(
        documents,
        thread.max_attachment_bytes,
        encodedSize,
      );
      const recipients = (list: string[]) =>
        list
          .filter((a) => a.toLowerCase() !== credentials.mailbox.toLowerCase())
          .map((a) => ({ emailAddress: { address: a } }));
      const draft = await microsoftFetch<{ id?: string; internetMessageId?: string }>(
        `${mailboxUrl(credentials.mailbox)}/messages/${encodeURIComponent(thread.reply_to_message_id)}/createReplyAll`,
        {
          token: t,
          json: {
            message: {
              toRecipients: recipients(thread.to),
              ccRecipients: recipients(thread.cc),
              from: {
                emailAddress: {
                  address: credentials.mailbox,
                  name:
                    message.author.kind === "member"
                      ? `${message.author.name} via ${ctx.fromName}`.slice(0, 120)
                      : ctx.fromName,
                },
              },
              body: {
                // HTML, which every mail app reflows to its window.
                contentType: "HTML",
                // Exchange may keep the mailbox's own name, so a member signs.
                content: mailHtml(
                  mailBody(message, {
                    fromName: ctx.fromName,
                    signMember: true,
                    tooLarge: tooLarge.map((d) => d.name),
                    withheld: [],
                  }),
                ),
              },
              singleValueExtendedProperties: [{ id: OUTBOUND_PROPERTY, value: message.id }],
              ...(message.author.kind === "mikegc"
                ? { internetMessageHeaders: [{ name: "X-Auto-Submitted", value: "auto-generated" }] }
                : {}),
            },
          },
          refused: MAILBOX_REFUSED,
        },
      );
      if (!draft?.id)
        throw new MicrosoftApiError({ status: 0, code: "invalid_response", permanent: false, sentence: "Microsoft sent an answer MikeGC couldn't read." });
      const draftUrl = `${mailboxUrl(credentials.mailbox)}/messages/${encodeURIComponent(draft.id)}`;
      for (const doc of attached) {
        const bytes = await ctx.readDocument(doc);
        if (bytes.byteLength <= SIMPLE_ATTACHMENT_BYTES) {
          await microsoftFetch(`${draftUrl}/attachments`, {
            token: t,
            json: {
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: doc.name,
              contentBytes: Buffer.from(bytes).toString("base64"),
            },
            refused: MAILBOX_REFUSED,
          });
        } else {
          const session = await microsoftFetch<{ uploadUrl?: unknown }>(
            `${draftUrl}/attachments/createUploadSession`,
            {
              token: t,
              json: { AttachmentItem: { attachmentType: "file", name: doc.name, size: bytes.byteLength } },
              refused: MAILBOX_REFUSED,
            },
          );
          if (!isMicrosoftUploadUrl(session?.uploadUrl))
            throw new MicrosoftApiError({ status: 0, code: "invalid_session", permanent: false, sentence: "Microsoft wouldn't take a document." });
          await uploadInSession(session.uploadUrl, bytes);
        }
        doc.externalId = "attached";
      }
      for (const doc of tooLarge) doc.leftOut = true;
      await microsoftFetch(`${draftUrl}/send`, { token: t, method: "POST", refused: MAILBOX_REFUSED });
      const externalId = draft.internetMessageId ?? draft.id;
      if (draft.internetMessageId)
        await recordEmailMessageIds(ctx.db, link.org_id, link.id, [draft.internetMessageId]);
      return { externalId: externalId.slice(0, 500), documents };
    } catch (error) {
      throw outlookError(error);
    }
  },
  async findDelivered(ctx, link, message) {
    try {
      const credentials = graphCredentials(ctx.settings);
      const sent = await findByOutbound(await token(credentials), credentials.mailbox, "sentitems", message.id);
      const found = sent[0];
      if (!found) return null;
      if (found.internetMessageId)
        await recordEmailMessageIds(ctx.db, link.org_id, link.id, [found.internetMessageId]);
      return (found.internetMessageId ?? found.id).slice(0, 500);
    } catch (error) {
      throw outlookError(error);
    }
  },
};
