// An organization's profile.
//
// What an organization's owners and admins tell MikeGC about it: what it
// does, its industry, where it is headquartered and where it operates, the
// companies in its group, the scope of its legal team, and anything else that
// helps. The assistant (chat and project chat) and the intake agent read it,
// with the organization's name, as background for work in the
// organization's workspace.
//
// In lib/ because three modules read it for their prompts (chat,
// project-chat and intake) and the orgs module, which owns the settings that
// write it, already depends on intake. Who may read and change it, and the
// audit line a change leaves, live in modules/orgs/orgs.profile.ts.

import { isPersonalOrgRow } from "./personalOrgs";
import { safeError } from "./safeError";
import type { Db } from "./supabase";

/**
 * The text fields. Each limit is the CHECK on the org_profiles column of the
 * same name; the web app's OrganizationProfileSettings mirrors them.
 */
export const ORG_PROFILE_TEXT_FIELDS = [
    { key: "about", label: "About", max: 2000 },
    { key: "industry", label: "Industry", max: 200 },
    { key: "headquarters_city", label: "Headquarters city", max: 100 },
    { key: "headquarters_country", label: "Headquarters country", max: 100 },
    { key: "legal_entities", label: "Legal entities", max: 1000 },
    { key: "legal_team_scope", label: "Scope of legal team", max: 1000 },
    { key: "additional_context", label: "Other context", max: 2000 },
] as const;

/** Jurisdictions are a list, picked from the web app's jurisdiction options. */
export const MAX_ORG_JURISDICTIONS = 300;
export const MAX_ORG_JURISDICTION_LENGTH = 100;

export type OrgProfileTextField =
    (typeof ORG_PROFILE_TEXT_FIELDS)[number]["key"];
export type OrgProfileField = OrgProfileTextField | "jurisdictions";

/** Every field: text is null where it is not set, jurisdictions empty. */
export type OrgProfile = Record<OrgProfileTextField, string | null> & {
    jurisdictions: string[];
};

/** Every field, in the order the settings page shows them. */
export const ORG_PROFILE_FIELDS: readonly OrgProfileField[] = [
    "about",
    "industry",
    "headquarters_city",
    "headquarters_country",
    "jurisdictions",
    "legal_entities",
    "legal_team_scope",
    "additional_context",
];

const FIELD_KEYS = new Set<string>(ORG_PROFILE_FIELDS);

/** The org_profiles columns that hold the fields, for a select. */
export const ORG_PROFILE_COLUMNS = ORG_PROFILE_FIELDS.join(", ");

export function emptyOrgProfile(): OrgProfile {
    const profile = { jurisdictions: [] as string[] } as OrgProfile;
    for (const { key } of ORG_PROFILE_TEXT_FIELDS) profile[key] = null;
    return profile;
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

/** A jurisdiction as it is stored: one line, single spaces. */
function normalizeJurisdiction(value: string): string {
    return normalizeOrgProfileText(value).replace(/\s+/g, " ");
}

/** A stored row, or none, as a profile. */
export function orgProfileFromRow(row: unknown): OrgProfile {
    const profile = emptyOrgProfile();
    if (!row || typeof row !== "object") return profile;
    const record = row as Record<string, unknown>;
    for (const { key } of ORG_PROFILE_TEXT_FIELDS) {
        const value = record[key];
        profile[key] = typeof value === "string" && value.trim() ? value : null;
    }
    if (Array.isArray(record.jurisdictions))
        profile.jurisdictions = record.jurisdictions.filter(
            (item): item is string => typeof item === "string" && !!item.trim(),
        );
    return profile;
}

/**
 * The changes a request body asks for. Only the fields it names change; an
 * empty string or null clears a text field, and an empty list or null clears
 * the jurisdictions. A value over its limit is refused rather than cut short,
 * so nobody's text is silently lost.
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
    for (const { key, label, max } of ORG_PROFILE_TEXT_FIELDS) {
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
    if ("jurisdictions" in raw) {
        const value = raw.jurisdictions;
        if (value === null) changes.jurisdictions = [];
        else if (
            !Array.isArray(value) ||
            value.some((item) => typeof item !== "string")
        )
            return {
                ok: false,
                detail: "jurisdictions must be a list of strings or null",
            };
        else {
            // Blank entries are dropped and repeats kept once, in the order given.
            const seen = new Set<string>();
            const list: string[] = [];
            for (const item of value as string[]) {
                const jurisdiction = normalizeJurisdiction(item);
                if (!jurisdiction || seen.has(jurisdiction.toLowerCase()))
                    continue;
                if (jurisdiction.length > MAX_ORG_JURISDICTION_LENGTH)
                    return {
                        ok: false,
                        detail: `Each jurisdiction must be ${MAX_ORG_JURISDICTION_LENGTH} characters or fewer.`,
                    };
                seen.add(jurisdiction.toLowerCase());
                list.push(jurisdiction);
            }
            if (list.length > MAX_ORG_JURISDICTIONS)
                return {
                    ok: false,
                    detail: `Choose at most ${MAX_ORG_JURISDICTIONS} jurisdictions.`,
                };
            changes.jurisdictions = list;
        }
    }
    return { ok: true, changes };
}

/** The profile as a prompt gives it: only what is set, headquarters as one place. */
export type OrgPromptProfile = {
    about?: string;
    industry?: string;
    headquarters?: string;
    jurisdictions?: string[];
    legal_entities?: string;
    legal_team_scope?: string;
    additional_context?: string;
};

export function orgPromptProfile(profile: OrgProfile): OrgPromptProfile {
    const headquarters = [profile.headquarters_city, profile.headquarters_country]
        .filter(Boolean)
        .join(", ");
    const facts: OrgPromptProfile = {};
    if (profile.about) facts.about = profile.about;
    if (profile.industry) facts.industry = profile.industry;
    if (headquarters) facts.headquarters = headquarters;
    if (profile.jurisdictions.length) facts.jurisdictions = profile.jurisdictions;
    if (profile.legal_entities) facts.legal_entities = profile.legal_entities;
    if (profile.legal_team_scope) facts.legal_team_scope = profile.legal_team_scope;
    if (profile.additional_context)
        facts.additional_context = profile.additional_context;
    return facts;
}

/** The organization a prompt is written for: its name and the profile fields that are set. */
export type OrgContext = {
    name: string;
    profile: OrgPromptProfile;
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
        return { name, profile: orgPromptProfile(values) };
    } catch (error) {
        console.warn("[org-profile] organization unreadable", safeError(error));
        return null;
    }
}
