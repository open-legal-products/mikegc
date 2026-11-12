import { z } from "zod";
import { DbJobDeferredError } from "../../lib/dbq/types";
import {
  acknowledgementLines,
  ChannelDeliveryError,
  DOCUMENTS_ONLY_TEXT,
  memberSender,
  type ChannelAdapter,
  type ChannelLink,
  type OutboundDocument,
  type OutboundMessage,
} from "./intake.channels";
import { channelAttachments } from "./intake.attachments";
import {
  MAX_MESSAGE_CHARS,
  cleanText,
  clip,
  clipStart,
  type TeamsFileRef,
  type TeamsInboundPayload,
} from "./intake.inboundPayload";
import { htmlToText } from "./intake.mail";
import {
  BOT_SCOPE,
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
import { teamsClientSecret } from "./intake.secrets";
import type { AutomationRow } from "./intake.settingsRow";
import type { InboundMessage } from "./intake.triage";

/**
 * Microsoft Teams through the organization's own single-tenant bot: what
 * Teams sends (checked against Bot Framework's signing keys), reading a
 * channel thread and its files through Microsoft Graph, and posting in the
 * thread through the Bot Connector. Documents are uploaded to the channel's
 * files folder, so channel members open them with their existing access.
 */

/** A failure reading from or posting to Teams. */
export const TeamsApiError = MicrosoftApiError;
export function isPermanentTeamsError(error: unknown): boolean {
  return error instanceof MicrosoftApiError && error.permanent;
}

const BOT_ISSUER = "https://api.botframework.com";
const BOT_OPENID_CONFIG =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";
const CLOCK_SKEW_SECONDS = 5 * 60;
/** Files at most this size go up in one PUT; larger ones in an upload session. */
const SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The activity fields MikeGC reads, leniently: an odd field is dropped. */
const maybe = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);
export const teamsActivity = z.object({
  type: z.string().max(100),
  id: z.string().min(1).max(200),
  timestamp: maybe(z.string().max(100)),
  serviceUrl: z.string().url().max(500),
  channelId: maybe(z.string().max(100)),
  from: z.object({
    id: z.string().min(1).max(300),
    name: maybe(z.string().max(500)),
    aadObjectId: maybe(z.string().max(100)),
  }),
  conversation: z.object({
    id: z.string().min(1).max(500),
    conversationType: maybe(z.string().max(50)),
    tenantId: maybe(z.string().max(100)),
  }),
  text: maybe(z.string().max(200_000)),
  textFormat: maybe(z.string().max(50)),
  entities: maybe(z.array(z.record(z.string(), z.unknown())).max(100)),
  attachments: maybe(
    z
      .array(
        z.object({
          contentType: maybe(z.string().max(200)),
          contentUrl: maybe(z.string().max(4000)),
          name: maybe(z.string().max(500)),
          content: maybe(z.unknown()),
        }),
      )
      .max(50),
  ),
  channelData: maybe(
    z.object({
      tenant: maybe(z.object({ id: maybe(z.string().max(100)) })),
      team: maybe(
        z.object({
          id: maybe(z.string().max(300)),
          name: maybe(z.string().max(500)),
          aadGroupId: maybe(z.string().max(100)),
        }),
      ),
      channel: maybe(
        z.object({ id: maybe(z.string().max(300)), name: maybe(z.string().max(500)) }),
      ),
      eventType: maybe(z.string().max(100)),
    }),
  ),
});
export type TeamsActivity = z.infer<typeof teamsActivity>;

/** Whether an activity mentions the bot (Teams names it 28:<app id>). */
export function teamsMentionsBot(activity: TeamsActivity, appId: string): boolean {
  return (activity.entities ?? []).some((e) => {
    const mentioned = e.mentioned as { id?: unknown } | undefined;
    return e.type === "mention" && mentioned?.id === `28:${appId}`;
  });
}

/**
 * An activity's text: its HTML with the bot's own <at> mention taken out,
 * read as plain text the way an HTML email is.
 */
export function teamsActivityText(activity: TeamsActivity, appId: string): string {
  const html =
    (activity.attachments ?? []).find(
      (a) => a.contentType === "text/html" && typeof a.content === "string",
    )?.content ?? activity.text ?? "";
  let source = String(html);
  for (const e of activity.entities ?? []) {
    const mentioned = e.mentioned as { id?: unknown } | undefined;
    if (e.type === "mention" && mentioned?.id === `28:${appId}` && typeof e.text === "string")
      source = source.split(e.text).join("");
  }
  return clip(cleanText(htmlToText(source)), MAX_MESSAGE_CHARS);
}

/** Files shared on a message: Teams sends them as SharePoint references. */
export function teamsActivityFiles(activity: TeamsActivity): TeamsFileRef[] {
  return (activity.attachments ?? [])
    .filter(
      (a) =>
        typeof a.contentUrl === "string" &&
        (a.contentType === "reference" ||
          a.contentType === "application/vnd.microsoft.teams.file.download.info"),
    )
    .slice(0, 20)
    .map((a) => ({
      name: clip(cleanText(a.name ?? ""), 255) || "Teams file",
      size: null,
      url: a.contentUrl ?? null,
    }));
}

/** Bot Connector hosts MikeGC sends its bot token to. */
export function isBotServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(^|\.)(trafficmanager\.net|botframework\.com|botframework\.us|teams\.microsoft\.com|teams\.microsoft\.us)$/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

type Jose = typeof import("jose", { with: { "resolution-mode": "import" } });
let joseModule: Promise<Jose> | null = null;
let keySet: { jwks: ReturnType<Jose["createRemoteJWKSet"]>; fetchedAt: number } | null = null;
const KEYS_REFRESH_MS = 24 * 60 * 60 * 1000;

/** jose is an ECMAScript module, loaded on first use. */
const loadJose = () => (joseModule ??= import("jose"));

/** Bot Framework's signing keys, cached; jose refreshes them on an unknown kid. */
async function botKeys(jose: Jose) {
  if (keySet && Date.now() - keySet.fetchedAt < KEYS_REFRESH_MS) return keySet.jwks;
  const response = await fetch(BOT_OPENID_CONFIG, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Bot Framework OpenID configuration unavailable");
  const config = (await response.json()) as { jwks_uri?: unknown };
  if (typeof config.jwks_uri !== "string" || !config.jwks_uri.startsWith("https://login.botframework.com/"))
    throw new Error("Bot Framework OpenID configuration invalid");
  keySet = {
    jwks: jose.createRemoteJWKSet(new URL(config.jwks_uri), {
      cooldownDuration: 30_000,
      cacheMaxAge: KEYS_REFRESH_MS,
    }),
    fetchedAt: Date.now(),
  };
  return keySet.jwks;
}

/** Tests replace the key set with their own. */
export function setBotKeysForTests(
  jwks: ReturnType<Jose["createRemoteJWKSet"]> | Parameters<Jose["jwtVerify"]>[1] | null,
) {
  keySet = jwks
    ? { jwks: jwks as ReturnType<Jose["createRemoteJWKSet"]>, fetchedAt: Date.now() }
    : null;
}

/**
 * Whether a request came from Teams for this bot: a Bot Connector JWT in
 * Authorization, signed with Bot Framework's keys, issued by Bot Framework
 * to the bot's app ID, within its lifetime (with five minutes' skew), for
 * the activity's own service URL.
 */
export async function verifyBotFrameworkToken(
  authorization: string | undefined,
  expected: { appId: string; serviceUrl: string },
): Promise<boolean> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return false;
  try {
    const jose = await loadJose();
    const { payload } = await jose.jwtVerify(token, await botKeys(jose), {
      issuer: BOT_ISSUER,
      audience: expected.appId,
      clockTolerance: CLOCK_SKEW_SECONDS,
      algorithms: ["RS256"],
    });
    const serviceUrl = (payload as { serviceUrl?: unknown; serviceurl?: unknown }).serviceUrl ??
      (payload as { serviceurl?: unknown }).serviceurl;
    const normalize = (u: string) => u.replace(/\/+$/, "").toLowerCase();
    return (
      typeof serviceUrl === "string" &&
      normalize(serviceUrl) === normalize(expected.serviceUrl) &&
      isBotServiceUrl(expected.serviceUrl)
    );
  } catch {
    return false;
  }
}

const CREDENTIALS_REFUSED =
  "Microsoft didn't accept the Teams app's credentials. An admin can check the app ID, tenant ID and client secret in Intake settings.";

function credentials(settings: AutomationRow) {
  const secret = teamsClientSecret(settings);
  if (!settings.teams_app_id || !settings.teams_tenant_id || !secret)
    throw new MicrosoftApiError({
      status: 0,
      code: "not_configured",
      permanent: true,
      sentence: "Teams isn't set up. An admin can add the app's credentials in Intake settings.",
    });
  return {
    tenantId: settings.teams_tenant_id,
    clientId: settings.teams_app_id,
    clientSecret: secret,
  };
}

const botToken = async (settings: AutomationRow) =>
  (await microsoftToken({ ...credentials(settings), scope: BOT_SCOPE }, { sentence: CREDENTIALS_REFUSED })).token;
const graphToken = async (settings: AutomationRow) =>
  (await microsoftToken({ ...credentials(settings), scope: GRAPH_SCOPE }, { sentence: CREDENTIALS_REFUSED })).token;

/** Graph application roles that let MikeGC read and post channel files. */
const FILE_ROLES = new Set(["Sites.Selected", "Files.ReadWrite.All", "Sites.ReadWrite.All"]);

/**
 * Check the Teams app's credentials with Microsoft, and whether its Graph
 * token can work with files.
 */
export async function checkTeamsCredentials(args: {
  appId: string;
  tenantId: string;
  secret: string;
}): Promise<{ ok: true; filesAccess: boolean } | { ok: false; refused: boolean }> {
  try {
    const key = { tenantId: args.tenantId, clientId: args.appId, clientSecret: args.secret };
    await microsoftToken({ ...key, scope: BOT_SCOPE }, { sentence: CREDENTIALS_REFUSED });
    const graph = await microsoftToken({ ...key, scope: GRAPH_SCOPE }, { sentence: CREDENTIALS_REFUSED });
    return { ok: true, filesAccess: graph.roles.some((r) => FILE_ROLES.has(r)) };
  } catch (error) {
    return { ok: false, refused: error instanceof MicrosoftApiError && error.permanent };
  }
}

type GraphChatMessage = {
  id: string;
  createdDateTime?: string;
  mentions?: {
    id?: number;
    mentionText?: string;
    mentioned?: { application?: { id?: string } | null } | null;
  }[];
  from?: {
    user?: { id?: string; displayName?: string } | null;
    application?: { id?: string; displayName?: string } | null;
  } | null;
  body?: { content?: string; contentType?: string };
  attachments?: { contentType?: string; contentUrl?: string; name?: string }[];
};

/** A channel thread's root and replies, oldest first, through Graph. */
async function graphThread(
  settings: AutomationRow,
  thread: { groupId: string; channelId: string; rootId: string },
): Promise<GraphChatMessage[]> {
  const token = await graphToken(settings);
  const base = `${GRAPH_API}/teams/${encodeURIComponent(thread.groupId)}/channels/${encodeURIComponent(thread.channelId)}/messages/${encodeURIComponent(thread.rootId)}`;
  const refused =
    "MikeGC can't read that Teams channel. A team owner can add the MikeGC app to the team.";
  const root = await microsoftFetch<GraphChatMessage>(base, { token, refused });
  const replies: GraphChatMessage[] = [];
  let next: string | null = `${base}/replies?$top=50`;
  for (let page = 0; next && page < 5; page++) {
    const data: { value?: GraphChatMessage[]; "@odata.nextLink"?: string } =
      await microsoftFetch(next, { token, refused });
    replies.push(...(data.value ?? []));
    const link = data["@odata.nextLink"];
    next = typeof link === "string" && link.startsWith(GRAPH_API) ? link : null;
  }
  const at = (m: GraphChatMessage) => Date.parse(m.createdDateTime ?? "") || 0;
  return [root, ...replies.sort((a, b) => at(a) - at(b))];
}

/**
 * A Graph message's text: the bot's own mentions taken out exactly as Graph
 * lists them, and the rest of the HTML read as text.
 */
function graphText(m: GraphChatMessage, appId: string): string {
  let html = m.body?.content ?? "";
  for (const mention of m.mentions ?? [])
    if (mention.mentioned?.application?.id === appId && typeof mention.id === "number")
      html = html.split(`<at id="${mention.id}">${mention.mentionText ?? ""}</at>`).join("");
  return clip(cleanText(htmlToText(html)), MAX_MESSAGE_CHARS);
}

/**
 * The Teams request: the mentioning message, or, for a mention in a reply,
 * the thread up to it, read through Graph, whose first author is then the
 * requester. A thread Graph won't show is recorded from the mention alone.
 */
export async function teamsInboundMessage(
  settings: AutomationRow,
  payload: TeamsInboundPayload,
): Promise<InboundMessage> {
  const appId = settings.teams_app_id ?? "";
  let entries: { author: string; at: Date; text: string; files: TeamsFileRef[] }[] = [
    {
      author: payload.from.name ?? "Teams user",
      at: new Date(payload.date),
      text: payload.text,
      files: payload.files,
    },
  ];
  if (payload.activity_id !== payload.root_message_id && payload.aad_group_id && payload.channel_id) {
    try {
      const thread = await graphThread(settings, {
        groupId: payload.aad_group_id,
        channelId: payload.channel_id,
        rootId: payload.root_message_id,
      });
      const mention = Date.parse(payload.date);
      const read = thread
        .filter((m) => m.from?.application?.id !== appId)
        .filter((m) => !mention || (Date.parse(m.createdDateTime ?? "") || 0) <= mention + 1000)
        .map((m) => ({
          id: m.id,
          author: m.from?.user?.displayName ?? "Teams user",
          at: new Date(m.createdDateTime ?? payload.date),
          text: graphText(m, appId),
          files: (m.attachments ?? [])
            .filter((a) => a.contentType === "reference" && a.contentUrl)
            .map((a) => ({ name: clip(cleanText(a.name ?? ""), 255) || "Teams file", size: null, url: a.contentUrl! })),
        }))
        .filter((m) => m.text.trim() || m.files.length);
      // The thread as far as Graph shows it, ending with the signed mention
      // even when Graph's copy of the thread stops short of it.
      if (read.length)
        entries = read.some((m) => m.id === payload.activity_id)
          ? read
          : [...read, entries[0]!];
    } catch (error) {
      if (error instanceof MicrosoftApiError && error.code === "not_configured") throw error;
      // Recorded from the mention alone.
    }
  }
  const sent = (d: Date) =>
    `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d)} UTC`;
  const text =
    entries.length === 1
      ? entries[0]!.text
      : entries.map((e) => `${e.author}, ${sent(e.at)}:\n${e.text}`).join("\n\n");
  const seen = new Set<string>();
  const files = entries
    .flatMap((e) => e.files)
    .filter((f) => {
      const key = f.url ?? f.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const firstLine = entries[0]!.text.split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  return {
    source: "teams",
    sender: { name: entries[0]!.author, email: null },
    // The mention's own time: "by Friday" counts from when MikeGC was asked,
    // not from when the thread began.
    sentAt: new Date(payload.date),
    subject: null,
    subjectHint: firstLine,
    text: clipStart(text, MAX_MESSAGE_CHARS),
    ...channelAttachments(files, "teams"),
  };
}

/** A Teams thread's address on its link. */
export type TeamsAddress = {
  service_url: string;
  tenant_id: string;
  team_id: string | null;
  aad_group_id: string | null;
  channel_id: string | null;
  conversation_id: string;
  root_message_id: string;
  channel_name: string | null;
  team_name: string | null;
  permalink: string | null;
};

/** A Teams deep link to a thread, when the team's group is known. */
function teamsDeepLink(payload: TeamsInboundPayload): string | null {
  if (!payload.channel_id || !payload.aad_group_id) return null;
  const params = new URLSearchParams({
    tenantId: payload.tenant_id,
    groupId: payload.aad_group_id,
    parentMessageId: payload.root_message_id,
    ...(payload.team_name ? { teamName: payload.team_name } : {}),
    ...(payload.channel_name ? { channelName: payload.channel_name } : {}),
  });
  return `https://teams.microsoft.com/l/message/${encodeURIComponent(payload.channel_id)}/${encodeURIComponent(payload.root_message_id)}?${params}`;
}

/** The thread a Teams request came from. */
export function teamsThread(payload: TeamsInboundPayload) {
  const address: TeamsAddress = {
    service_url: payload.service_url,
    tenant_id: payload.tenant_id,
    team_id: payload.team_id,
    aad_group_id: payload.aad_group_id,
    channel_id: payload.channel_id,
    conversation_id: payload.conversation_id,
    root_message_id: payload.root_message_id,
    channel_name: payload.channel_name,
    team_name: payload.team_name,
    permalink: teamsDeepLink(payload),
  };
  return {
    source: "teams" as const,
    key: `${payload.tenant_id}:${payload.conversation_id}`,
    address: address as unknown as Record<string, unknown>,
  };
}

function teamsAddress(link: ChannelLink): TeamsAddress {
  const a = link.address as Partial<TeamsAddress>;
  if (typeof a.service_url !== "string" || typeof a.conversation_id !== "string")
    throw new ChannelDeliveryError("MikeGC lost track of this request's Teams thread.", true);
  return a as TeamsAddress;
}

/** "u!" and the URL in unpadded base64url: how Graph's /shares names a sharing URL. */
export function shareId(url: string): string {
  return `u!${Buffer.from(url, "utf8").toString("base64url")}`;
}

const SHAREPOINT = /^https:\/\/[a-z0-9-]+(?:-my)?\.sharepoint\.(?:com|us|de|cn)\//i;

/** A file shared in a channel, through Graph; null when larger than `maxBytes`. */
export async function teamsDownloadFile(
  settings: AutomationRow,
  url: string,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  if (!SHAREPOINT.test(url) || settings.teams_files_access === false) return null;
  const token = await graphToken(settings);
  const response = await microsoftResponse(
    `${GRAPH_API}/shares/${shareId(url)}/driveItem/content`,
    {
      token,
      long: true,
      refused: "MikeGC can't open files in that Teams channel.",
    },
  );
  return readLimited(response, maxBytes);
}

/** A Teams member's email, as the Bot Connector reports it; null if it won't. */
export async function teamsMemberEmail(
  settings: AutomationRow,
  link: ChannelLink,
  memberId: string,
): Promise<string | null> {
  const address = teamsAddress(link);
  if (!isBotServiceUrl(address.service_url)) return null;
  const token = await botToken(settings);
  const member = await microsoftFetch<{ email?: unknown; userPrincipalName?: unknown }>(
    `${address.service_url.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(address.conversation_id)}/members/${encodeURIComponent(memberId)}`,
    { token },
  );
  const email = typeof member?.email === "string" ? member.email : member?.userPrincipalName;
  return typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email) ? email.toLowerCase().slice(0, 320) : null;
}

/** Text placed in a Teams markdown message, with its markup escaped. */
export function teamsEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_~[\]()#|])/g, "\\$1");
}

/** The message as Teams markdown: line breaks kept, a member signing their own. */
export function teamsMessageText(
  message: OutboundMessage,
  options: { fromName: string; files: { name: string; url: string | null }[]; withheld: string[] },
): string {
  const lines: string[] = [];
  if (message.acknowledgement) {
    lines.push(...acknowledgementLines(message.acknowledgement, message.text, teamsEscape));
  } else {
    const text = message.text || (message.documents.length ? DOCUMENTS_ONLY_TEXT : "");
    if (message.author.kind === "member") {
      const who = teamsEscape(memberSender(message.author.name, options.fromName));
      lines.push(message.kind === "question" ? `${who} asks:` : `${who}:`);
    }
    lines.push(...text.split("\n").map(teamsEscape));
  }
  const linked = options.files.filter((f) => f.url);
  if (linked.length)
    lines.push("", `Documents: ${linked.map((f) => `[${teamsEscape(f.name)}](${f.url})`).join(" · ")}`);
  if (options.withheld.length)
    lines.push("", `I couldn't share ${options.withheld.map(teamsEscape).join(", ")} here, so ask Legal for a copy.`);
  // Teams markdown needs two spaces or a blank line for a break.
  return lines.join("  \n");
}

/** A folder name for a request's documents: its subject, safe for SharePoint. */
function folderName(subject: string): string {
  return (
    subject
      .replace(/["*:<>?/\\|#%~&{}]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100) || "Request"
  );
}

/** Upload a document to the channel's files folder; returns its web URL. */
async function uploadToChannel(
  settings: AutomationRow,
  address: TeamsAddress,
  subject: string,
  doc: OutboundDocument,
  bytes: ArrayBuffer,
): Promise<string> {
  if (!address.aad_group_id || !address.channel_id)
    throw new MicrosoftApiError({ status: 404, code: "no_channel", permanent: true, sentence: "MikeGC can't find the Teams channel's files." });
  const token = await graphToken(settings);
  const refused = "MikeGC can't add files to that Teams channel. An admin can grant document access in Intake settings.";
  const folder = await microsoftFetch<{ id?: string; parentReference?: { driveId?: string } }>(
    `${GRAPH_API}/teams/${encodeURIComponent(address.aad_group_id)}/channels/${encodeURIComponent(address.channel_id)}/filesFolder`,
    { token, refused },
  );
  const driveId = folder?.parentReference?.driveId;
  if (!folder?.id || !driveId)
    throw new MicrosoftApiError({ status: 404, code: "no_folder", permanent: true, sentence: "MikeGC can't find the Teams channel's files." });
  const path = ["MikeGC", folderName(subject), doc.name.replace(/[/\\]/g, " ")]
    .map(encodeURIComponent)
    .join("/");
  const item = `${GRAPH_API}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folder.id)}:/${path}:`;
  let uploaded: { webUrl?: unknown } | null;
  if (bytes.byteLength <= SIMPLE_UPLOAD_BYTES) {
    uploaded = await microsoftFetch(`${item}/content?@microsoft.graph.conflictBehavior=rename`, {
      token,
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "Content-Type": "application/octet-stream" },
      long: true,
      refused,
    });
  } else {
    const session = await microsoftFetch<{ uploadUrl?: unknown }>(`${item}/createUploadSession`, {
      token,
      json: { item: { "@microsoft.graph.conflictBehavior": "rename" } },
      refused,
    });
    if (!isMicrosoftUploadUrl(session?.uploadUrl))
      throw new MicrosoftApiError({ status: 0, code: "invalid_session", permanent: false, sentence: "Microsoft wouldn't take a document." });
    uploaded = await uploadInSession(session.uploadUrl, bytes);
  }
  const webUrl = uploaded?.webUrl;
  if (typeof webUrl !== "string" || !webUrl.startsWith("https://"))
    throw new MicrosoftApiError({ status: 0, code: "invalid_response", permanent: false, sentence: "Microsoft wouldn't take a document." });
  return webUrl;
}

/** A Microsoft failure as the delivery job handles it. */
function teamsDeliveryError(error: unknown, channelName: string | null): Error {
  if (!(error instanceof MicrosoftApiError)) return error as Error;
  if (error.retryAfterMs)
    return new DbJobDeferredError(new Date(Date.now() + error.retryAfterMs).toISOString(), "teams_retry_after");
  if (error.code === "MessageWritesBlocked" || error.code === "BotNotInConversationRoster" || error.status === 403)
    return new ChannelDeliveryError(
      channelName
        ? `Couldn't send: MikeGC was removed from ${channelName}.`
        : "Couldn't send: MikeGC can't post in that Teams channel.",
      true,
    );
  if (error.status === 404)
    return new ChannelDeliveryError("The Teams thread is gone.", true);
  return new ChannelDeliveryError(error.sentence, error.permanent);
}

const normalized = (value: string) =>
  htmlToText(value).replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The Teams adapter. Teams can't change the sender of one message, so a
 * member's question reads "Emma Chen (Legal) asks: …". Documents go to the
 * channel's files folder first, then the message links to them.
 */
export const teamsAdapter: ChannelAdapter = {
  source: "teams",
  async deliver(ctx, link, message, delivered) {
    if (!ctx.settings.teams_enabled)
      throw new ChannelDeliveryError("Teams is turned off in Intake settings, so MikeGC can't post in the thread.", true);
    const address = teamsAddress(link);
    if (!isBotServiceUrl(address.service_url))
      throw new ChannelDeliveryError("MikeGC lost track of this request's Teams thread.", true);
    const channelName = address.channel_name ? `${address.channel_name}` : null;
    try {
      const documents = message.documents.map((d) => ({ ...d }));
      const canUpload = ctx.settings.teams_files_access === true;
      for (const doc of documents) {
        if (doc.externalId || doc.leftOut || !canUpload) continue;
        try {
          doc.externalId = await uploadToChannel(
            ctx.settings,
            address,
            message.requestSubject,
            doc,
            await ctx.readDocument(doc),
          );
        } catch (error) {
          // A document Microsoft refuses is named in the reply instead, so the
          // reply still goes; anything that may pass on a retry is retried.
          if (!(error instanceof MicrosoftApiError && error.permanent)) throw error;
        }
        await ctx.saveProgress({ documents });
      }
      const withheld = documents.filter((d) => !d.externalId && !d.leftOut);
      for (const doc of withheld) doc.leftOut = true;
      if (delivered) return { externalId: delivered, documents };
      const token = await botToken(ctx.settings);
      const posted = await microsoftFetch<{ id?: unknown }>(
        `${address.service_url.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(address.conversation_id)}/activities`,
        {
          token,
          json: {
            type: "message",
            textFormat: "markdown",
            text: teamsMessageText(message, {
              fromName: ctx.fromName,
              files: documents.filter((d) => d.externalId).map((d) => ({ name: d.name, url: d.externalId ?? null })),
              withheld: withheld.map((d) => d.name),
            }),
          },
        },
      );
      const id = typeof posted?.id === "string" ? posted.id.slice(0, 200) : null;
      if (!id)
        throw new MicrosoftApiError({ status: 0, code: "invalid_response", permanent: false, sentence: "Microsoft sent an answer MikeGC couldn't read." });
      return { externalId: id, documents };
    } catch (error) {
      throw teamsDeliveryError(error, channelName);
    }
  },
  async findDelivered(ctx, link, message, attemptedAt) {
    const address = teamsAddress(link);
    if (!address.aad_group_id || !address.channel_id || !ctx.settings.teams_app_id) return null;
    const since = attemptedAt ? Date.parse(attemptedAt) - 60_000 : 0;
    // Teams messages other outbox rows in this thread already own.
    const { data: owned, error: ownedError } = await ctx.db
      .from("intake_outbound")
      .select("id, external_id")
      .eq("link_id", link.id)
      .not("external_id", "is", null);
    if (ownedError) throw ownedError;
    const taken = new Set(
      ((owned ?? []) as { id: string; external_id: string | null }[])
        .filter((row) => row.id !== message.id && row.external_id)
        .map((row) => row.external_id!),
    );
    const expected = normalized(
      teamsMessageText(message, { fromName: ctx.fromName, files: [], withheld: [] }),
    ).slice(0, 120);
    try {
      const thread = await graphThread(ctx.settings, {
        groupId: address.aad_group_id,
        channelId: address.channel_id,
        rootId: address.root_message_id,
      });
      const found = thread.find(
        (m) =>
          !taken.has(m.id) &&
          m.from?.application?.id === ctx.settings.teams_app_id &&
          (Date.parse(m.createdDateTime ?? "") || 0) >= since &&
          normalized(m.body?.content ?? "").startsWith(expected.slice(0, 60)),
      );
      return found?.id ?? null;
    } catch (error) {
      throw teamsDeliveryError(error, address.channel_name ?? null);
    }
  },
};
