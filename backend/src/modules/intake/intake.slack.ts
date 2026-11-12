import { createHmac, timingSafeEqual } from "node:crypto";
import {
  acknowledgementLines,
  ChannelDeliveryError,
  DOCUMENTS_ONLY_TEXT,
  memberSender,
  type ChannelAdapter,
  type ChannelLink,
  type OutboundMessage,
} from "./intake.channels";
import { slackBotToken } from "./intake.secrets";

/**
 * A small client for the organization's own Slack app: the Web API methods
 * automated intake uses, request signing, and Slack's message markup. Every
 * call has a deadline, and failures carry only Slack's error code, never a
 * response body or the token.
 */

const SLACK_API = "https://slack.com/api/";
const API_TIMEOUT_MS = 10_000;
const FILE_TIMEOUT_MS = 60_000;
/** Slack's replay window for signed requests. */
const SIGNATURE_WINDOW_SECONDS = 5 * 60;

/** A Slack Web API failure. `code` is Slack's error string, safe to log. */
export class SlackApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Slack API error (${code})`);
    this.name = "SlackApiError";
    this.code = code;
  }
}

/** Failures that retrying cannot fix: the app's setup has to change. */
const PERMANENT = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_allowed_token_type",
  "missing_scope",
  "no_permission",
  "not_in_channel",
  "channel_not_found",
  "thread_not_found",
  "message_not_found",
  "is_archived",
  "invalid_file_url",
  "file_not_authorized",
]);
export function isPermanentSlackError(error: unknown): boolean {
  return error instanceof SlackApiError && PERMANENT.has(error.code);
}
/** Codes meaning the bot token itself was refused. */
/** How many users.info lookups for one message run at a time. */
export const SLACK_LOOKUPS_AT_ONCE = 5;

export const SLACK_TOKEN_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_allowed_token_type",
]);

const safeCode = (value: unknown) =>
  typeof value === "string" && /^[a-z0-9_]{1,60}$/.test(value)
    ? value
    : "unknown_error";

/**
 * Whether a request came from the Slack app holding `secret`: `v0=` and the
 * HMAC-SHA256 of `v0:<timestamp>:<raw body>`, sent within five minutes.
 */
export function verifySlackSignature(args: {
  secret: string;
  rawBody: Buffer;
  timestamp: string | undefined;
  signature: string | undefined;
  nowMs?: number;
}): boolean {
  const { timestamp, signature } = args;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;
  if (!signature || !/^v0=[0-9a-f]{64}$/.test(signature)) return false;
  const expected =
    "v0=" +
    createHmac("sha256", args.secret)
      .update(`v0:${timestamp}:`)
      .update(args.rawBody)
      .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Form-encoded, which every Web API method accepts, unlike JSON bodies. */
async function slackApi<T>(
  method: string,
  token: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  return (await slackApiWithHeaders<T>(method, token, params)).data;
}

async function slackApiWithHeaders<T>(
  method: string,
  token: string,
  params: Record<string, string | undefined> = {},
): Promise<{ data: T; headers: Headers }> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) body.set(key, value);
  let response: Response;
  try {
    response = await fetch(SLACK_API + method, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new SlackApiError("network_error");
  }
  if (response.status === 429) throw new SlackApiError("ratelimited");
  if (!response.ok) throw new SlackApiError(`http_${response.status}`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SlackApiError("invalid_response");
  }
  const data = json as { ok?: unknown; error?: unknown } | null;
  if (data?.ok !== true) throw new SlackApiError(safeCode(data?.error));
  return { data: json as T, headers: response.headers };
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/**
 * The workspace and bot a token belongs to, and the token's scopes, which
 * Slack sends in the X-OAuth-Scopes header; null when it doesn't.
 */
export async function slackAuthTest(token: string) {
  const { data, headers } = await slackApiWithHeaders<Record<string, unknown>>(
    "auth.test",
    token,
  );
  const teamId = text(data.team_id, 40);
  const userId = text(data.user_id, 40);
  if (!teamId || !userId) throw new SlackApiError("invalid_response");
  const header = headers.get("x-oauth-scopes");
  const scopes = header
    ? header
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9:._-]{1,60}$/i.test(s))
        .slice(0, 100)
    : null;
  return { team_id: teamId, team: text(data.team, 200), user_id: userId, scopes };
}

/** Scopes the requester loop needs beyond recording requests. */
export const SLACK_LOOP_SCOPES = ["files:write", "chat:write.customize"] as const;

export type SlackPerson = { name: string | null; email: string | null };

/** A person's name and, with users:read.email, address; null if unknown. */
export async function slackUserInfo(
  token: string,
  userId: string,
): Promise<SlackPerson | null> {
  try {
    const data = await slackApi<{ user?: Record<string, unknown> }>(
      "users.info",
      token,
      { user: userId },
    );
    const user = data.user ?? {};
    const profile = (user.profile ?? {}) as Record<string, unknown>;
    return {
      name:
        text(profile.real_name, 200) ??
        text(user.real_name, 200) ??
        text(profile.display_name, 200) ??
        text(user.name, 200),
      email: text(profile.email, 320),
    };
  } catch (error) {
    if (error instanceof SlackApiError && error.code === "user_not_found")
      return null;
    throw error;
  }
}

export type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  size?: number;
  mode?: string;
  is_external?: boolean;
  url_private_download?: string;
};
export type SlackMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  files?: SlackFile[];
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
};

/** Order Slack timestamps ("1700000000.000100") without float rounding. */
export function compareSlackTs(a: string, b: string): number {
  const [aSec = "0", aFrac = ""] = a.split(".");
  const [bSec = "0", bFrac = ""] = b.split(".");
  const seconds = Number(aSec) - Number(bSec);
  if (seconds !== 0) return Math.sign(seconds);
  return Math.sign(Number(aFrac.padEnd(6, "0")) - Number(bFrac.padEnd(6, "0")));
}

/** A thread's messages, oldest first, up to and including `latest`. */
export async function slackThreadMessages(
  token: string,
  channel: string,
  threadTs: string,
  latest: string,
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  // Five pages of 200 is far more than a request thread needs.
  for (let page = 0; page < 5; page++) {
    const data = await slackApi<{
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.replies", token, {
      channel,
      ts: threadTs,
      latest,
      inclusive: "true",
      limit: "200",
      cursor,
    });
    messages.push(
      ...(data.messages ?? []).filter(
        (m) => typeof m?.ts === "string" && compareSlackTs(m.ts, latest) <= 0,
      ),
    );
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return messages.sort((a, b) => compareSlackTs(a.ts, b.ts));
}

/** The metadata event type MikeGC marks its intake messages with. */
export const SLACK_METADATA_EVENT = "mikegc_intake";

/**
 * Post in a thread and return the message's ts. Links are not unfurled, so
 * the reply stays compact. `outboundId` is written into the message's
 * metadata, so a retry can find a post that landed; `username` (with
 * chat:write.customize) posts under a member's name.
 */
export async function slackPostMessage(
  token: string,
  args: {
    channel: string;
    threadTs: string;
    text: string;
    outboundId?: string;
    username?: string;
  },
): Promise<string | null> {
  const data = await slackApi<{ ts?: unknown }>("chat.postMessage", token, {
    channel: args.channel,
    thread_ts: args.threadTs,
    text: args.text,
    unfurl_links: "false",
    unfurl_media: "false",
    username: args.username,
    metadata: args.outboundId
      ? JSON.stringify({
          event_type: SLACK_METADATA_EVENT,
          event_payload: { outbound_id: args.outboundId },
        })
      : undefined,
  });
  return typeof data.ts === "string" && SLACK_TS_PATTERN.test(data.ts) ? data.ts : null;
}

const SLACK_TS_PATTERN = /^\d{1,12}\.\d{1,8}$/;

/**
 * The ts of MikeGC's message in a thread carrying `outboundId` in its
 * metadata, posted after `oldest`; null when none landed. A thread too busy
 * to search to the end throws "search_incomplete": whether it landed is
 * unknown, and posting again could repeat it.
 */
export async function slackFindByMetadata(
  token: string,
  args: { channel: string; threadTs: string; outboundId: string; oldest?: string },
): Promise<string | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const data = await slackApi<{
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.replies", token, {
      channel: args.channel,
      ts: args.threadTs,
      oldest: args.oldest,
      include_all_metadata: "true",
      limit: "200",
      cursor,
    });
    const found = (data.messages ?? []).find(
      (m) =>
        m.metadata?.event_type === SLACK_METADATA_EVENT &&
        m.metadata.event_payload?.outbound_id === args.outboundId,
    );
    if (found) return found.ts;
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) return null;
  }
  throw new SlackApiError("search_incomplete");
}

/** One message of a thread by its ts, or null when it is gone. */
export async function slackThreadMessage(
  token: string,
  args: { channel: string; threadTs: string; ts: string },
): Promise<SlackMessage | null> {
  const data = await slackApi<{ messages?: SlackMessage[] }>(
    "conversations.replies",
    token,
    {
      channel: args.channel,
      ts: args.threadTs,
      latest: args.ts,
      oldest: args.ts,
      inclusive: "true",
      limit: "5",
    },
  );
  return (data.messages ?? []).find((m) => m.ts === args.ts) ?? null;
}

/** A link to a message, for the request page; null when Slack won't say. */
export async function slackPermalink(
  token: string,
  channel: string,
  ts: string,
): Promise<string | null> {
  try {
    const data = await slackApi<{ permalink?: unknown }>("chat.getPermalink", token, {
      channel,
      message_ts: ts,
    });
    const link = text(data.permalink, 2000);
    return link && link.startsWith("https://") ? link : null;
  } catch (error) {
    if (error instanceof SlackApiError && SLACK_TOKEN_ERRORS.has(error.code)) throw error;
    return null;
  }
}

/** A channel's name, with channels:read or groups:read; null otherwise. */
export async function slackChannelName(
  token: string,
  channel: string,
): Promise<string | null> {
  try {
    const data = await slackApi<{ channel?: { name?: unknown } }>(
      "conversations.info",
      token,
      { channel },
    );
    return text(data.channel?.name, 200);
  } catch (error) {
    if (error instanceof SlackApiError && SLACK_TOKEN_ERRORS.has(error.code)) throw error;
    return null;
  }
}

/**
 * Upload a file into a thread: get an upload URL, send the bytes, then
 * complete the upload into the channel and thread. Needs files:write.
 * Returns Slack's file ID.
 */
export async function slackUploadFile(
  token: string,
  args: { channel: string; threadTs: string; filename: string; bytes: ArrayBuffer; assertActive?: () => Promise<void> },
): Promise<string> {
  await args.assertActive?.();
  const ticket = await slackApi<{ upload_url?: unknown; file_id?: unknown }>(
    "files.getUploadURLExternal",
    token,
    { filename: args.filename, length: String(args.bytes.byteLength) },
  );
  const uploadUrl = text(ticket.upload_url, 4000);
  const fileId = text(ticket.file_id, 40);
  if (!uploadUrl || !fileId) throw new SlackApiError("invalid_response");
  let target: URL;
  try {
    target = new URL(uploadUrl);
  } catch {
    throw new SlackApiError("invalid_response");
  }
  // Only Slack's own upload host is ever sent the file.
  if (target.protocol !== "https:" || !/(^|\.)slack\.com$/.test(target.hostname))
    throw new SlackApiError("invalid_response");
  let response: Response;
  await args.assertActive?.();
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(args.bytes),
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
  } catch {
    throw new SlackApiError("network_error");
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 429) throw new SlackApiError("ratelimited");
  if (!response.ok) throw new SlackApiError(`http_${response.status}`);
  await args.assertActive?.();
  await slackApi("files.completeUploadExternal", token, {
    files: JSON.stringify([{ id: fileId, title: args.filename }]),
    channel_id: args.channel,
    thread_ts: args.threadTs,
  });
  return fileId;
}

/**
 * Download a file shared in Slack with the bot token. Only Slack's file host
 * is ever sent the token, and the body is read no further than `maxBytes`:
 * a larger file returns null.
 */
export async function downloadSlackFile(
  token: string,
  url: string,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new SlackApiError("invalid_file_url");
  }
  if (target.protocol !== "https:" || target.hostname !== "files.slack.com")
    throw new SlackApiError("invalid_file_url");
  let response: Response;
  try {
    // A cross-origin redirect drops the Authorization header (Fetch spec).
    response = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
  } catch {
    throw new SlackApiError("network_error");
  }
  if (response.status === 429) throw new SlackApiError("ratelimited");
  if (!response.ok) throw new SlackApiError(`http_${response.status}`);
  // Slack answers an unauthorized file request with its sign-in page.
  if ((response.headers.get("content-type") ?? "").includes("text/html")) {
    await response.body?.cancel().catch(() => undefined);
    throw new SlackApiError("file_not_authorized");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

const MENTION = /<@([UW][A-Z0-9]{1,30})(?:\|[^>]*)?>/g;

/** The people a message mentions, by Slack user ID. */
export function mentionedUsers(value: string): string[] {
  return [...value.matchAll(MENTION)].map((match) => match[1]!);
}

/**
 * Slack's markup as plain text: `<@U1>` becomes the person's name,
 * `<url|label>` becomes "label (url)", and the escaped `&`, `<` and `>` are
 * restored. Mentions of MikeGC itself are dropped.
 */
export function slackTextToPlain(
  value: string,
  names: ReadonlyMap<string, string>,
  botUserId: string | null,
): string {
  return value
    .replace(/<([^<>]*)>/g, (_match, inner: string) => {
      const bar = inner.indexOf("|");
      const target = bar >= 0 ? inner.slice(0, bar) : inner;
      const label = bar >= 0 ? inner.slice(bar + 1) : "";
      if (target.startsWith("@")) {
        const id = target.slice(1);
        if (id === botUserId) return "";
        return `@${names.get(id) ?? (label || "someone")}`;
      }
      if (target.startsWith("#")) return `#${label || "channel"}`;
      if (target.startsWith("!")) {
        // <!here>, <!subteam^S1|@legal>, <!date^…|fallback text>
        if (label) return label;
        return `@${target.slice(1).split("^")[0]}`;
      }
      const address = target.startsWith("mailto:") ? target.slice(7) : null;
      if (!label || label === target || label === address)
        return address ?? target;
      return `${label} (${target})`;
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Text placed inside a Slack message, with its control characters escaped. */
export function slackEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A Slack thread's address on its link. */
export type SlackAddress = {
  team_id: string | null;
  channel: string;
  thread_ts: string;
  channel_name?: string | null;
  permalink?: string | null;
};

function slackAddress(link: ChannelLink): SlackAddress {
  const a = link.address as Partial<SlackAddress>;
  if (typeof a.channel !== "string" || typeof a.thread_ts !== "string")
    throw new ChannelDeliveryError("MikeGC lost track of this request's Slack thread.", true);
  return a as SlackAddress;
}

/** A failed Slack call as the sentence members see, and whether to retry. */
export function slackDeliveryError(error: unknown, channelName: string | null): Error {
  if (!(error instanceof SlackApiError)) return error as Error;
  const code = error.code;
  if (SLACK_TOKEN_ERRORS.has(code))
    return new ChannelDeliveryError(
      "Slack rejected MikeGC's bot token. An admin can save a new one in Intake settings.",
      true,
    );
  if (code === "not_in_channel" || code === "channel_not_found" || code === "is_archived")
    return new ChannelDeliveryError(
      channelName
        ? `Couldn't send: MikeGC was removed from #${channelName}.`
        : "Couldn't send: MikeGC isn't in that Slack channel. Invite @MikeGC to it.",
      true,
    );
  if (code === "thread_not_found" || code === "message_not_found")
    return new ChannelDeliveryError("The Slack thread was deleted.", true);
  if (code === "missing_scope" || code === "no_permission")
    return new ChannelDeliveryError(
      "The Slack app is missing a permission. Reinstall it from the manifest in the setup guide.",
      true,
    );
  if (code === "search_incomplete")
    return new ChannelDeliveryError(
      "MikeGC couldn't tell whether this reached the Slack thread. Check the thread, and copy the text if it isn't there.",
      true,
    );
  if (code === "restricted_action" || code === "msg_too_long" || code === "invalid_blocks")
    return new ChannelDeliveryError("Slack wouldn't accept this message.", true);
  return new ChannelDeliveryError("MikeGC couldn't reach Slack.", false);
}

/** The message as Slack text, escaped, with a member's name where Slack can't set it. */
export function slackMessageText(
  message: OutboundMessage,
  options: { fromName: string; customize: boolean },
): string {
  if (message.acknowledgement)
    return acknowledgementLines(message.acknowledgement, message.text, slackEscape).join("\n");
  const text = slackEscape(
    message.text || (message.documents.length ? DOCUMENTS_ONLY_TEXT : ""),
  );
  if (message.author.kind === "member" && !options.customize) {
    const who = slackEscape(memberSender(message.author.name, options.fromName));
    return message.kind === "question" ? `${who} asks:\n${text}` : `${who}:\n${text}`;
  }
  return text;
}

/** A Slack ts a little before `iso`, so a search starts before the first attempt. */
export function slackTsBefore(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return `${Math.floor(ms / 1000) - 120}.000000`;
}

/**
 * The Slack adapter. A member's question and the resolution are posted
 * under the member's name with chat:write.customize (Slack still shows its
 * APP badge); MikeGC's own messages keep its name. Documents follow the text
 * in the thread, each recorded as it lands, so a retry uploads only the rest.
 */
export const slackAdapter: ChannelAdapter = {
  source: "slack",
  async deliver(ctx, link, message, delivered) {
    const token = slackBotToken(ctx.settings);
    if (!token || !ctx.settings.slack_enabled)
      throw new ChannelDeliveryError(
        "Slack is turned off in Intake settings, so MikeGC can't post in the thread.",
        true,
      );
    const address = slackAddress(link);
    const channelName = address.channel_name ?? null;
    const scopes = ctx.settings.slack_scopes ?? null;
    const customize = !scopes || scopes.includes("chat:write.customize");
    let ts = delivered;
    try {
      if (!ts) {
        await ctx.assertActive();
        ts = await slackPostMessage(token, {
          channel: address.channel,
          threadTs: address.thread_ts,
          text: slackMessageText(message, { fromName: ctx.fromName, customize }),
          outboundId: message.id,
          username:
            message.author.kind === "member" && customize
              ? memberSender(message.author.name, ctx.fromName)
              : undefined,
        });
        if (!ts) throw new SlackApiError("invalid_response");
        await ctx.saveProgress({ externalId: ts });
      }
      const documents = message.documents.map((d) => ({ ...d }));
      const canUpload = !scopes || scopes.includes("files:write");
      for (const doc of documents) {
        if (doc.externalId || doc.leftOut) continue;
        if (!canUpload) {
          doc.leftOut = true;
          continue;
        }
        try {
          doc.externalId = await slackUploadFile(token, {
            channel: address.channel,
            threadTs: address.thread_ts,
            filename: doc.name,
            bytes: await ctx.readDocument(doc),
            assertActive: ctx.assertActive,
          });
        } catch (error) {
          // Without files:write the text still went; the request says why.
          if (error instanceof SlackApiError && error.code === "missing_scope")
            doc.leftOut = true;
          else throw error;
        }
        await ctx.saveProgress({ documents });
      }
      return { externalId: ts, documents };
    } catch (error) {
      throw slackDeliveryError(error, channelName);
    }
  },
  async findDelivered(ctx, link, message, attemptedAt) {
    const token = slackBotToken(ctx.settings);
    if (!token) return null;
    const address = slackAddress(link);
    try {
      return await slackFindByMetadata(token, {
        channel: address.channel,
        threadTs: address.thread_ts,
        outboundId: message.id,
        oldest: slackTsBefore(attemptedAt),
      });
    } catch (error) {
      throw slackDeliveryError(error, address.channel_name ?? null);
    }
  },
};
