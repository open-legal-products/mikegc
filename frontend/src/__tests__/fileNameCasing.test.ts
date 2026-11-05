// Fitness test: no two import paths in the frontend differ only in case.
//
// macOS and Windows file systems are case-insensitive by default; the Linux
// CI runners' is not. Two entries in one directory whose import paths differ
// only in case therefore build and test cleanly in CI and break on a Mac.
// The intake notifications change added `IntakeNotifications.tsx` beside
// `intakeNotifications.ts` (since renamed `intakeNotificationToasts.ts`).
// TypeScript tries `.ts` before `.tsx`, so on a Mac `./IntakeNotifications`
// resolved to the helper module, and `npm run typecheck` failed with a
// missing export and a file-name casing conflict while every Linux check
// passed.
//
// The rule: within a directory, no two entries may share an import path that
// differs only in case. A source file's import path is its name without its
// extension; a directory's is its name, since `./name` resolves to its index
// file; any other file's is its full name.

import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

const MODULE_EXTENSION = /\.(?:d\.[cm]?ts|[cm]?tsx?|[cm]?jsx?|json)$/;

function importPath(name: string, isDirectory: boolean): string {
    return isDirectory ? name : name.replace(MODULE_EXTENSION, "");
}

function caseCollisions(dir: string, out: string[] = []): string[] {
    const spellings = new Map<string, Set<string>>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const isDirectory = entry.isDirectory();
        const path = importPath(entry.name, isDirectory);
        const key = path.toLowerCase();
        const seen = spellings.get(key) ?? new Set<string>();
        seen.add(path);
        spellings.set(key, seen);
        if (isDirectory) caseCollisions(join(dir, entry.name), out);
    }
    const where = relative(SRC, dir).split(sep).join("/") || ".";
    for (const seen of spellings.values()) {
        if (seen.size > 1) out.push(`${where}: ${[...seen].sort().join(", ")}`);
    }
    return out;
}

describe("frontend file names", () => {
    it("has no import paths that differ only in case", () => {
        expect(
            caseCollisions(SRC),
            "These names differ only in case. They work on Linux but collide on " +
                "case-insensitive file systems (macOS, Windows), where an import " +
                "can resolve to the wrong file and type-checking fails. Rename " +
                "one so the names differ by more than case.",
        ).toEqual([]);
    });
});
