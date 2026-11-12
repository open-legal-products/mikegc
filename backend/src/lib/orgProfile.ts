// An organization's profile.
//
// What an organization's owners and admins tell MikeGC about it: what it
// does, its industry, where it is based and where it operates, the companies
// in its group, its legal team, and anything else that helps. The assistant
// (chat and project chat) and the intake agent read it, with the
// organization's name, as background for work in the organization's
// workspace.
//
// In lib/ because three modules read it for their prompts (chat,
// project-chat and intake) and the orgs module, which owns the settings that
// write it, already depends on intake. Who may read and change it, and the
// audit line a change leaves, live in modules/orgs/orgs.profile.ts.

import { isPersonalOrgRow } from "./personalOrgs";
import { safeError } from "./safeError";
import type { Db } from "./supabase";

/**
 * The fields, in the order the settings page shows them and a prompt lists
 * them. Each limit is the CHECK on the org_profiles column of the same name;
 * the web app's OrganizationProfileSettings mirrors them.
 */
export const ORG_PROFILE_FIELDS = [
    { key: "about", label: "About", max: 2000 },
    { key: "industry", label: "Industry", max: 200 },
    { key: "headquarters", label: "Headquarters", max: 200 },
    { key: "jurisdictions", label: "Jurisdictions", max: 500 },
    { key: "legal_entities", label: "Legal entities", max: 1000 },
    { key: "legal_team", label: "Legal team", max: 1000 },
    { key: "additional_context", label: "Other context", max: 2000 },
] as const;

export type OrgProfileField = (typeof ORG_PROFILE_FIELDS)[number]["key"];

/** Every field, null where it is not set. */
export type OrgProfile = Record<OrgProfileField, string | null>;

const FIELD_KEYS = new Set<string>(ORG_PROFILE_FIELDS.map((field) => field.key));

/** The org_profiles columns that hold the fields, for a select. */
export const ORG_PROFILE_COLUMNS = ORG_PROFILE_FIELDS.map(
    (field) => field.key,
).join(", ");

export function emptyOrgProfile(): OrgProfile {
    return Object.fromEntries(
        ORG_PROFILE_FIELDS.map((field) => [field.key, null]),
    ) as OrgProfile;
}

/**
 * The text as it is stored: plain line endings, no control characters other
 * than newlines and tabs (Postgres text cannot hold NUL at all), and no
 * whitespace around it.
 */
export function normalizeOrgProfileText(value: string): string {
    return value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim();
}

/** A stored row, or none, as a profile. */
export function orgProfileFromRow(row: unknown): OrgProfile {
    const profile = emptyOrgProfile();
    if (!row || typeof row !== "object") return profile;
    for (const { key } of ORG_PROFILE_FIELDS) {
        const value = (row as Record<string, unknown>)[key];
        profile[key] =
            typeof value === "string" && value.trim() ? value : null;
    }
    return profile;
}

/**
 * The changes a request body asks for. Only the fields it names change; an
 * empty string or null clears one. A value over its limit is refused rather
 * than cut short, so nobody's text is silently lost.
 */
export function parseOrgProfileInput(
    body: unknown,
):
    | { ok: true; changes: Partial<OrgProfile> }
    | { ok: false; detail: string } {
    if (!body || typeof body !== "object" || Array.isArray(body))
        return { ok: false, detail: "Expected a JSON object" };
    const raw = body as Record<string, unknown>;
    const unknownField = Object.keys(raw).find((key) => !FIELD_KEYS.has(key));
    if (unknownField)
        return {
            ok: false,
            detail: `Unsupported profile field: ${unknownField}`,
        };
    const changes: Partial<OrgProfile> = {};
    for (const { key, label, max } of ORG_PROFILE_FIELDS) {
        if (!(key in raw)) continue;
        const value = raw[key];
        if (value === null) {
            changes[key] = null;
            continue;
        }
        if (typeof value !== "string")
            return { ok: false, detail: `${key} must be a string or null` };
        const text = normalizeOrgProfileText(value);
        if (text.length > max)
            return {
                ok: false,
                detail: `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`,
            };
        changes[key] = text || null;
    }
    return { ok: true, changes };
}

/** The organization a prompt is written for: its name and the profile fields that are set. */
export type OrgContext = {
    name: string;
    profile: Partial<Record<OrgProfileField, string>>;
};

/**
 * The organization the assistant or the intake agent works for. Null for no
 * organization, a person's own (which has no profile and is never presented
 * as an organization), one that is not there, or a read that failed: the
 * work goes on without the background rather than failing for it. A profile
 * that cannot be read still leaves the name.
 */
export async function loadOrgContext(
    db: Db,
    orgId: string | null | undefined,
): Promise<OrgContext | null> {
    if (!orgId) return null;
    try {
        const [org, profile] = await Promise.all([
            // `*` rather than naming `kind`, which a database that has not
            // run the personal-organizations migration does not have.
            db.from("organizations").select("*").eq("id", orgId).maybeSingle(),
            db
                .from("org_profiles")
                .select(ORG_PROFILE_COLUMNS)
                .eq("org_id", orgId)
                .maybeSingle(),
        ]);
        if (org.error) throw org.error;
        const row = org.data as { name?: unknown } | null;
        if (!row || isPersonalOrgRow(row)) return null;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) return null;
        if (profile.error)
            console.warn(
                "[org-profile] profile unreadable; using the name alone",
                safeError(profile.error),
            );
        const values = profile.error
            ? emptyOrgProfile()
            : orgProfileFromRow(profile.data);
        const set: OrgContext["profile"] = {};
        for (const { key } of ORG_PROFILE_FIELDS) {
            const value = values[key];
            if (value) set[key] = value;
        }
        return { name, profile: set };
    } catch (error) {
        console.warn("[org-profile] organization unreadable", safeError(error));
        return null;
    }
}
