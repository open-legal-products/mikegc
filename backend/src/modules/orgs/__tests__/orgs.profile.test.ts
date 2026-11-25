import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/access", () => ({
    getOrgRole: vi.fn(async () => "admin"),
    isOrgAdmin: (role: string | null) => role === "owner" || role === "admin",
}));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

import type { Db } from "../../../lib/supabase";
import { saveOrgProfile } from "../orgs.profile";

/**
 * Two admins save different fields at nearly the same time. This one read
 * the profile before the other's save landed; the database row it writes
 * into already has the other admin's industry.
 */
function racingDb() {
    const before = { about: "Accounting software", industry: null, jurisdictions: [], updated_at: "t0" };
    const stored = { ...before, industry: "Fintech", headquarters_city: "London", updated_at: "t2" };
    const upserts: unknown[] = [];
    const db = {
        from: () => {
            let upserting = false;
            const builder: Record<string, unknown> = {
                select: () => builder,
                eq: () => builder,
                upsert: (row: unknown) => {
                    upserting = true;
                    upserts.push(row);
                    return builder;
                },
                maybeSingle: async () => ({ data: before, error: null }),
                single: async () => ({ data: upserting ? stored : before, error: null }),
            };
            return builder;
        },
    } as unknown as Db;
    return { db, upserts };
}

describe("saveOrgProfile", () => {
    it("writes only the changed field, and answers with the row as stored", async () => {
        const { db, upserts } = racingDb();

        const result = await saveOrgProfile(db, {
            actorId: "admin-1",
            orgId: "org-1",
            body: { headquarters_city: "London" },
        });

        expect(upserts).toEqual([
            expect.objectContaining({ org_id: "org-1", headquarters_city: "London" }),
        ]);
        expect(upserts[0]).not.toHaveProperty("industry");
        // The other admin's change is in the answer, not lost until reload.
        expect(result).toMatchObject({
            ok: true,
            profile: {
                about: "Accounting software",
                industry: "Fintech",
                headquarters_city: "London",
                updated_at: "t2",
            },
        });
    });
});
