/**
 * Display order of device-only Word chat messages.
 *
 * Fail-without-fix: rows saved before `sequence` existed fell back to a
 * role rank (user 0, assistant 1), so a legacy chat showed every question
 * first and every answer after them.
 */
import { describe, expect, it } from "vitest";
import { compareLocalMessageRows } from "../../../word-addin/src/taskpane/lib/localWordChats";

describe("compareLocalMessageRows", () => {
    it("orders legacy rows by creation time, before sequenced rows", () => {
        const rows = [
            { id: "d", role: "assistant", created_at: "2026-01-01T00:00:04Z" },
            { id: "c", role: "user", created_at: "2026-01-01T00:00:03Z" },
            { id: "f", role: "assistant", created_at: "2026-01-02T00:00:00Z", sequence: 5 },
            { id: "b", role: "assistant", created_at: "2026-01-01T00:00:01Z" },
            { id: "e", role: "user", created_at: "2026-01-02T00:00:00Z", sequence: 4 },
            // Same instant as its answer: the question still comes first.
            { id: "z", role: "user", created_at: "2026-01-01T00:00:01Z" },
        ] as const;

        expect([...rows].sort(compareLocalMessageRows).map((row) => row.id)).toEqual(
            ["z", "b", "c", "d", "e", "f"],
        );
    });
});
