// An organization's profile: what its owners and admins tell the assistant
// and the intake agent about it (lib/orgProfile.ts has the fields and the
// reading for prompts).
//
// Behind the module facade (orgs.service.ts). Every member may read it, as
// they may see the logo: it is background to their own chats, and nothing in
// it is meant to be hidden from them. Only owners and admins change it.

import { getOrgRole, isOrgAdmin } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import {
    ORG_PROFILE_COLUMNS,
    ORG_PROFILE_FIELDS,
    orgProfileFromRow,
    parseOrgProfileInput,
    type OrgProfile,
    type OrgProfileField,
} from "../../lib/orgProfile";
import type { OrgResult } from "../../lib/orgs";
import type { Db } from "../../lib/supabase";

/** The profile as the settings page reads it. */
export type OrgProfileSettings = OrgProfile & {
    /** When it last changed, or null before anything was ever set. */
    updated_at: string | null;
};

const SETTINGS_COLUMNS = `${ORG_PROFILE_COLUMNS}, updated_at`;

/** A stored row, or none, as the settings page reads it. */
function settingsFromRow(row: unknown): OrgProfileSettings {
    const updatedAt = (row as { updated_at?: unknown } | null)?.updated_at;
    return {
        ...orgProfileFromRow(row),
        updated_at: typeof updatedAt === "string" ? updatedAt : null,
    };
}

async function readProfile(
    db: Db,
    orgId: string,
): Promise<{ ok: true; profile: OrgProfileSettings } | { ok: false; detail: string }> {
    const { data, error } = await db
        .from("org_profiles")
        .select(SETTINGS_COLUMNS)
        .eq("org_id", orgId)
        .maybeSingle();
    if (error) return { ok: false, detail: error.message };
    return { ok: true, profile: settingsFromRow(data) };
}

/** The organization's profile, for any of its members. Empty until set. */
export async function getOrgProfile(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ profile: OrgProfileSettings }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    const read = await readProfile(db, params.orgId);
    if (!read.ok) return { ok: false, kind: "db_error", detail: read.detail };
    return { ok: true, profile: read.profile };
}

/**
 * Change the fields the body names (owners and admins only); an empty
 * string or null clears one. Only the fields that change are written, so two
 * admins editing different fields at once do not undo each other.
 */
export async function saveOrgProfile(
    db: Db,
    params: {
        actorId: string;
        actorEmail?: string | null;
        orgId: string;
        body: unknown;
    },
): Promise<OrgResult<{ profile: OrgProfileSettings }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };

    const parsed = parseOrgProfileInput(params.body);
    if (!parsed.ok)
        return { ok: false, kind: "validation", detail: parsed.detail };

    const current = await readProfile(db, params.orgId);
    if (!current.ok)
        return { ok: false, kind: "db_error", detail: current.detail };

    const changed: OrgProfileField[] = ORG_PROFILE_FIELDS.filter(
        (key) =>
            key in parsed.changes &&
            // Text compares as text; the jurisdictions as an ordered list.
            JSON.stringify(parsed.changes[key]) !==
                JSON.stringify(current.profile[key]),
    );
    if (changed.length === 0) return { ok: true, profile: current.profile };

    const updatedAt = new Date().toISOString();
    const write: Record<string, unknown> = {
        org_id: params.orgId,
        updated_by: params.actorId,
        updated_at: updatedAt,
    };
    for (const key of changed) write[key] = parsed.changes[key];
    // The row as stored, so the answer also carries any field another admin
    // saved since the read above.
    const { data: stored, error } = await db
        .from("org_profiles")
        .upsert(write, { onConflict: "org_id" })
        .select(SETTINGS_COLUMNS)
        .single();
    if (error) return { ok: false, kind: "db_error", detail: error.message };

    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        action: "org.profile.updated",
        // Which fields, never what they say.
        detail: { org_id: params.orgId, fields: changed },
    });

    return { ok: true, profile: settingsFromRow(stored) };
}
