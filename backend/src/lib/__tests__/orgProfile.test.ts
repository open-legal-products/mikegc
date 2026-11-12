import { describe, expect, it, vi } from "vitest";
import type { Db } from "../supabase";
import {
    MAX_ORG_JURISDICTIONS,
    ORG_PROFILE_TEXT_FIELDS,
    emptyOrgProfile,
    loadOrgContext,
    normalizeOrgProfileText,
    orgProfileFromRow,
    orgPromptProfile,
    parseOrgProfileInput,
} from "../orgProfile";

type Answer = { data: unknown; error: unknown };

/** A db whose two reads answer as given, recording which tables were read. */
function fakeDb(answers: { organizations?: Answer; org_profiles?: Answer }) {
    const read: string[] = [];
    const db = {
        from: (table: string) => {
            read.push(table);
            const answer =
                answers[table as keyof typeof answers] ?? { data: null, error: null };
            const builder = {
                select: () => builder,
                eq: () => builder,
                maybeSingle: async () => answer,
            };
            return builder;
        },
    } as unknown as Db;
    return { db, read };
}

describe("parseOrgProfileInput", () => {
    it("tidies text and clears a field given null or only whitespace", () => {
        expect(
            parseOrgProfileInput({
                about: "  Line one\r\nLine two\u0000  ",
                industry: "   ",
                headquarters_city: null,
            }),
        ).toEqual({
            ok: true,
            changes: {
                about: "Line one\nLine two",
                industry: null,
                headquarters_city: null,
            },
        });
    });

    it("leaves out the fields the body does not name", () => {
        expect(parseOrgProfileInput({})).toEqual({ ok: true, changes: {} });
    });

    it("refuses what is not a profile", () => {
        for (const body of [null, "about", [], 42])
            expect(parseOrgProfileInput(body)).toEqual({
                ok: false,
                detail: "Expected a JSON object",
            });
        for (const field of ["website", "legal_team", "headquarters"])
            expect(parseOrgProfileInput({ [field]: "x" })).toEqual({
                ok: false,
                detail: `Unsupported profile field: ${field}`,
            });
        expect(parseOrgProfileInput({ about: 1 })).toEqual({
            ok: false,
            detail: "about must be a string or null",
        });
    });

    it("holds every text field to its limit, counted after tidying", () => {
        for (const { key, label, max } of ORG_PROFILE_TEXT_FIELDS) {
            expect(parseOrgProfileInput({ [key]: ` ${"x".repeat(max)} ` })).toEqual({
                ok: true,
                changes: { [key]: "x".repeat(max) },
            });
            expect(parseOrgProfileInput({ [key]: "x".repeat(max + 1) })).toEqual({
                ok: false,
                detail: `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`,
            });
        }
    });

    it("keeps jurisdictions as a tidy list, each once, in the order given", () => {
        expect(
            parseOrgProfileInput({
                jurisdictions: [" England and Wales ", "", "New\nYork", "england AND wales", "Delaware"],
            }),
        ).toEqual({
            ok: true,
            changes: { jurisdictions: ["England and Wales", "New York", "Delaware"] },
        });
        expect(parseOrgProfileInput({ jurisdictions: null })).toEqual({
            ok: true,
            changes: { jurisdictions: [] },
        });
    });

    it("refuses jurisdictions that are not a short list of names", () => {
        for (const jurisdictions of ["England", [1], [["England"]], {}])
            expect(parseOrgProfileInput({ jurisdictions })).toEqual({
                ok: false,
                detail: "jurisdictions must be a list of strings or null",
            });
        expect(parseOrgProfileInput({ jurisdictions: ["x".repeat(101)] })).toEqual({
            ok: false,
            detail: "Each jurisdiction must be 100 characters or fewer.",
        });
        const many = Array.from({ length: MAX_ORG_JURISDICTIONS + 1 }, (_, i) => `Place ${i}`);
        expect(parseOrgProfileInput({ jurisdictions: many })).toEqual({
            ok: false,
            detail: `Choose at most ${MAX_ORG_JURISDICTIONS} jurisdictions.`,
        });
        expect(
            parseOrgProfileInput({ jurisdictions: many.slice(0, MAX_ORG_JURISDICTIONS) }),
        ).toMatchObject({ ok: true });
    });
});

describe("normalizeOrgProfileText", () => {
    it("keeps newlines and tabs, and removes other control characters", () => {
        expect(normalizeOrgProfileText("a\tb\nc\u0007d\u001Fe\u007F")).toBe("a\tb\ncde");
    });
});

describe("orgProfileFromRow", () => {
    it("reads every field: text null where blank or missing, jurisdictions as strings", () => {
        expect(
            orgProfileFromRow({
                about: "Ours",
                industry: "",
                jurisdictions: ["England and Wales", "", 3],
                extra: "x",
            }),
        ).toEqual({
            about: "Ours",
            industry: null,
            headquarters_city: null,
            headquarters_country: null,
            jurisdictions: ["England and Wales"],
            legal_entities: null,
            legal_team_scope: null,
            additional_context: null,
        });
        expect(orgProfileFromRow(null)).toEqual(emptyOrgProfile());
    });
});

describe("orgPromptProfile", () => {
    it("gives only what is set, with the headquarters as one place", () => {
        expect(
            orgPromptProfile({
                ...emptyOrgProfile(),
                headquarters_city: "London",
                headquarters_country: "United Kingdom",
                jurisdictions: ["England and Wales"],
                legal_team_scope: "Commercial contracts",
            }),
        ).toEqual({
            headquarters: "London, United Kingdom",
            jurisdictions: ["England and Wales"],
            legal_team_scope: "Commercial contracts",
        });
        expect(
            orgPromptProfile({ ...emptyOrgProfile(), headquarters_country: "Singapore" }),
        ).toEqual({ headquarters: "Singapore" });
        expect(orgPromptProfile(emptyOrgProfile())).toEqual({});
    });
});

describe("loadOrgContext", () => {
    it("reads nothing without an organization", async () => {
        const { db, read } = fakeDb({});
        expect(await loadOrgContext(db, null)).toBeNull();
        expect(read).toEqual([]);
    });

    it("gives a team organization's name and the fields that are set", async () => {
        const { db } = fakeDb({
            organizations: { data: { id: "org-1", name: " Acme Ltd ", kind: "team" }, error: null },
            org_profiles: {
                data: {
                    about: "Accounting software",
                    industry: null,
                    legal_team_scope: "  ",
                    headquarters_city: "London",
                    jurisdictions: ["England and Wales"],
                },
                error: null,
            },
        });
        expect(await loadOrgContext(db, "org-1")).toEqual({
            name: "Acme Ltd",
            profile: {
                about: "Accounting software",
                headquarters: "London",
                jurisdictions: ["England and Wales"],
            },
        });
    });

    it("gives nothing for a person's own organization, or one that is not there", async () => {
        const personal = fakeDb({
            organizations: {
                data: { id: "org-p", name: "Personal", kind: "personal", personal_user_id: "u-1" },
                error: null,
            },
            org_profiles: { data: { about: "Mine" }, error: null },
        });
        expect(await loadOrgContext(personal.db, "org-p")).toBeNull();
        expect(await loadOrgContext(fakeDb({}).db, "org-gone")).toBeNull();
    });

    it("goes on without the background when a read fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const noOrg = fakeDb({
            organizations: { data: null, error: { message: "secret detail" } },
        });
        expect(await loadOrgContext(noOrg.db, "org-1")).toBeNull();

        const noProfile = fakeDb({
            organizations: { data: { id: "org-1", name: "Acme Ltd" }, error: null },
            org_profiles: { data: null, error: { code: "42P01", message: "missing" } },
        });
        expect(await loadOrgContext(noProfile.db, "org-1")).toEqual({
            name: "Acme Ltd",
            profile: {},
        });
        // Nothing the database said reaches the log.
        expect(JSON.stringify(warn.mock.calls)).not.toContain("secret detail");
        warn.mockRestore();
    });
});
