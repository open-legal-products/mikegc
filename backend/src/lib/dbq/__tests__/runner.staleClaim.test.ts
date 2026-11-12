import { it, expect, vi } from "vitest";
vi.mock("../../supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../storage", () => ({ deleteFile: vi.fn(), downloadFile: vi.fn(), uploadFile: vi.fn() }));
import { processClaimedJob, NonRetryableJobError } from "../runner";
import { markConversionFailed } from "../../../modules/documents/documents.conversionJobs";
import type { DbJob } from "../types";

it("an obsolete conversion claimant cannot overwrite the successful document", async () => {
  const row: Record<string, unknown> = {
    id: "job-1", status: "done", attempts: 2, claimed_at: "2026-11-12T00:11:00Z",
  };
  const document: Record<string, unknown> = { id: "doc-1", status: "ready" };
  const db = {
    from(table: string) {
      let payload = {};
      const filters: Record<string, unknown> = {};
      const query = {
        select() { return query; },
        update(value: object) { payload = value; return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        then(resolve: (value: unknown) => unknown) {
          const target = table === "db_jobs" ? row : document;
          const matches = Object.entries(filters).every(([key, value]) => target[key] === value);
          if (matches) Object.assign(target, payload);
          return Promise.resolve({ data: matches ? [{ id: target.id }] : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const job: DbJob = {
    id: "job-1", kind: "conversion.convert", payload: { documentId: "doc-1" },
    status: "running", attempts: 1, max_attempts: 3, claimed_at: "2026-11-12T00:00:00Z",
    run_at: "", finished_at: null, last_error: null, dedupe_key: null, result: null, created_at: "",
  };
  await processClaimedJob(db as never, {
    "conversion.convert": async () => {
      throw new NonRetryableJobError("old attempt failed", { reportLevel: null });
    },
  }, job, { "conversion.convert": markConversionFailed });
  expect(row.status).toBe("done");
  expect(document.status).toBe("ready");
});
