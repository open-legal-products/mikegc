// exportContracts — implementation behind the module facade.
/** The export types a client may request; anything else is a 400 upstream. */
export const EXPORT_TYPES = [
    "account",
    "chats",
    "tabular-reviews",
    "audit-csv",
    "documents-zip",
    "memory-zip",
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
/**
 * The exports Settings > Privacy & Data offers. Each covers one workspace,
 * named by `params.workspace`, and in an organization needs its owners to
 * allow members to export.
 */
const WORKSPACE_EXPORT_TYPES = [
    "account",
    "chats",
    "tabular-reviews",
    "memory-zip",
] as const satisfies readonly ExportType[];
export function isWorkspaceExportType(type: ExportType): boolean {
    return (WORKSPACE_EXPORT_TYPES as readonly ExportType[]).includes(type);
}
/** The whole-account JSON exports: one artifact per (user, type). */
const JSON_EXPORT_TYPES = ["account", "chats", "tabular-reviews"] as const;
export type JsonExportType = (typeof JSON_EXPORT_TYPES)[number];
/**
 * Bound the selection metadata and authorization work separately from the
 * streamed archive's byte limit. Oversized selections are rejected with a
 * 400; the handler also rejects malformed persisted jobs without retrying.
 */
export const MAX_ZIP_EXPORT_DOCUMENTS = 500;
/** Durable request identity and stored input; execution revalidates permissions. */
export type ExportBuildRequest = {
    id: string;
    payload: Record<string, unknown>;
};
