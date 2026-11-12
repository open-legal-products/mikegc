import { createHash } from "node:crypto";

/**
 * A small client for the organization's own Microsoft Entra app: tokens by
 * client credentials, and Microsoft Graph and Bot Connector calls with
 * deadlines. Failures carry only a status and Microsoft's error code, never
 * a response body or a token, and say whether retrying can help.
 */

const TOKEN_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 20_000;
const FILE_TIMEOUT_MS = 120_000;

export const GRAPH_API = "https://graph.microsoft.com/v1.0";
export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
export const BOT_SCOPE = "https://api.botframework.com/.default";

/** A failed Microsoft call. `sentence` is what members or admins see. */
export class MicrosoftApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly permanent: boolean;
  readonly sentence: string;
  /** How long Microsoft asked us to wait, for a 429 or 503. */
  readonly retryAfterMs: number | null;
  constructor(args: {
    status: number;
    code: string;
    permanent: boolean;
    sentence: string;
    retryAfterMs?: number | null;
  }) {
    super(`Microsoft API error (${args.status} ${args.code})`);
    this.name = "MicrosoftApiError";
    this.status = args.status;
    this.code = args.code;
    this.permanent = args.permanent;
    this.sentence = args.sentence.slice(0, 200);
    this.retryAfterMs = args.retryAfterMs ?? null;
  }
}

const safeCode = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value)
    ? value
    : "unknown";

type TokenKey = { tenantId: string; clientId: string; clientSecret: string; scope: string };
const tokens = new Map<string, { token: string; expiresAt: number; roles: string[] }>();

/** The roles an app token was granted, read from its payload (our own token). */
function tokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles)
      ? payload.roles.filter((r): r is string => typeof r === "string").slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

const TENANT = /^[A-Za-z0-9.-]{1,200}$/;

/**
 * A token for `scope` by client credentials, cached until shortly before it
 * expires. Credentials Microsoft refuses are a permanent failure.
 */
export async function microsoftToken(
  key: TokenKey,
  options: { sentence: string } = {
    sentence: "Microsoft didn't accept the app's credentials. An admin can check them in Intake settings.",
  },
): Promise<{ token: string; roles: string[] }> {
  if (!TENANT.test(key.tenantId))
    throw new MicrosoftApiError({
      status: 400,
      code: "invalid_tenant",
      permanent: true,
      sentence: options.sentence,
    });
  // A digest of the secret, never the secret: a new secret gets a new token.
  const secretDigest = createHash("sha256").update(key.clientSecret).digest("hex");
  const cacheKey = JSON.stringify([key.tenantId, key.clientId, key.scope, secretDigest]);
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: key.clientId,
    client_secret: key.clientSecret,
    scope: key.scope,
  });
  let response: Response;
  try {
    response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(key.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      },
    );
  } catch {
    throw new MicrosoftApiError({
      status: 0,
      code: "network_error",
      permanent: false,
      sentence: "MikeGC couldn't reach Microsoft.",
    });
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // An unreadable body is judged by its status.
  }
  if (!response.ok || typeof json.access_token !== "string") {
    const permanent = response.status === 400 || response.status === 401;
    throw new MicrosoftApiError({
      status: response.status,
      code: safeCode(json.error),
      permanent,
      sentence: permanent ? options.sentence : "MikeGC couldn't reach Microsoft.",
    });
  }
  const expiresIn = Number(json.expires_in);
  const entry = {
    token: json.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    roles: tokenRoles(json.access_token),
  };
  tokens.set(cacheKey, entry);
  return entry;
}

/** Forget cached tokens, as tests and a credentials change need. */
export function clearMicrosoftTokens() {
  tokens.clear();
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1), 3600) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 1000), 3_600_000) : null;
}

export type MicrosoftCall = {
  token: string;
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Long uploads and downloads get a longer deadline. */
  long?: boolean;
  /** The sentence for a refusal (401/403), which needs a setting changed. */
  refused?: string;
  /** The sentence for a 404. */
  missing?: string;
};

/**
 * One call, answered with its parsed JSON (or null for an empty body). A 401
 * or 403 is permanent, as is a 404; 429 and 5xx are transient and carry
 * Microsoft's Retry-After.
 */
export async function microsoftFetch<T>(url: string, call: MicrosoftCall): Promise<T> {
  const response = await microsoftResponse(url, call);
  if (response.status === 202 || response.status === 204) return null as T;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MicrosoftApiError({
      status: response.status,
      code: "invalid_response",
      permanent: false,
      sentence: "Microsoft sent an answer MikeGC couldn't read.",
    });
  }
}

/** One call, answered with the raw response once it succeeded. */
export async function microsoftResponse(url: string, call: MicrosoftCall): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: call.method ?? (call.json !== undefined || call.body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${call.token}`,
        ...(call.json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...call.headers,
      },
      body: call.json !== undefined ? JSON.stringify(call.json) : call.body,
      signal: AbortSignal.timeout(call.long ? FILE_TIMEOUT_MS : API_TIMEOUT_MS),
    });
  } catch {
    throw new MicrosoftApiError({
      status: 0,
      code: "network_error",
      permanent: false,
      sentence: "MikeGC couldn't reach Microsoft.",
    });
  }
  if (response.ok) return response;
  let code = `http_${response.status}`;
  try {
    const json = (await response.json()) as { error?: { code?: unknown } | string; code?: unknown };
    code = safeCode(typeof json.error === "object" ? json.error?.code : json.error ?? json.code);
  } catch {
    // The status says enough.
  }
  const status = response.status;
  if (status === 429 || status >= 500)
    throw new MicrosoftApiError({
      status,
      code,
      permanent: false,
      sentence: "Microsoft is busy. MikeGC will try again.",
      retryAfterMs: retryAfter(response),
    });
  if (status === 401 || status === 403)
    throw new MicrosoftApiError({
      status,
      code,
      permanent: true,
      sentence: call.refused ?? "Microsoft refused MikeGC. An admin can check the app's permissions in Intake settings.",
    });
  if (status === 404)
    throw new MicrosoftApiError({
      status,
      code,
      permanent: true,
      sentence: call.missing ?? "Microsoft couldn't find what MikeGC asked for.",
    });
  throw new MicrosoftApiError({
    status,
    code,
    permanent: true,
    sentence: "Microsoft wouldn't accept this request.",
  });
}

/**
 * Read a response body no further than `maxBytes`: null when it is larger.
 */
export async function readLimited(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
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

/** Upload chunks of an upload session: 320 KiB multiples, at most 60 MiB each. */
export async function uploadInSession(
  uploadUrl: string,
  bytes: ArrayBuffer,
  assertActive?: () => Promise<void>,
): Promise<Record<string, unknown> | null> {
  const chunk = 320 * 1024 * 12; // 3.75 MiB
  const data = new Uint8Array(bytes);
  let last: Record<string, unknown> | null = null;
  for (let start = 0; start < data.length; start += chunk) {
    await assertActive?.();
    const end = Math.min(start + chunk, data.length);
    let response: Response;
    try {
      // The session URL is pre-authorized; it is sent no token.
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(end - start),
          "Content-Range": `bytes ${start}-${end - 1}/${data.length}`,
        },
        body: data.slice(start, end),
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
      });
    } catch {
      throw new MicrosoftApiError({
        status: 0,
        code: "network_error",
        permanent: false,
        sentence: "MikeGC couldn't reach Microsoft.",
      });
    }
    if (!response.ok)
      throw new MicrosoftApiError({
        status: response.status,
        code: `upload_${response.status}`,
        permanent: response.status < 500 && response.status !== 429,
        sentence: "Microsoft wouldn't take a document.",
      });
    const text = await response.text();
    try {
      last = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      last = null;
    }
  }
  return last;
}

/** Microsoft's upload session hosts, which are sent file bytes and nothing else. */
export function isMicrosoftUploadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(^|\.)(sharepoint\.com|outlook\.office\.com|outlook\.office365\.com|graph\.microsoft\.com|office\.net)$/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
