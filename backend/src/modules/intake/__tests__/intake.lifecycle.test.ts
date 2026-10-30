import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { validateIntakeExport } from "../intake.lifecycle";
import { intakeRpc } from "../intake.shared";
const id = "00000000-0000-4000-8000-000000000001";
const export_revision = 1;
const incarnation_id = "00000000-0000-4000-8000-000000000002";
describe("older intake export manifests", () => {
  it("validates precisely the serialized requests in pages of 100", async () => {
    const rpc = vi.fn(async () => ({ error: null, data: true }));
    const requests = Array.from({ length: 101 }, () => ({
      id,
      incarnation_id,
      export_revision,
    }));
    expect(
      await validateIntakeExport({ rpc } as unknown as Db, id, {
        version: 1,
        requests,
      }),
    ).toBe(true);
    expect(rpc.mock.calls).toEqual([
      ["intake_validate_export", { p_actor: id, p_requests: requests.slice(0, 100) }],
      ["intake_validate_export", { p_actor: id, p_requests: requests.slice(100) }],
    ]);
  });
  it.each([
    null,
    {},
    { version: 2, requests: [] },
    { version: 1, request_ids: [id] },
    { version: 1, requests: [{ id }] },
    { version: 1, requests: [{ id, incarnation_id }] },
    ...[0, -1, 1.5, "1"].map(export_revision => ({ version: 1, requests: [{ id, incarnation_id, export_revision }] })),
    { version: 1, requests: [{ id: "x", incarnation_id }] },
  ])("fails closed for a malformed manifest %j", async (manifest) => {
    const rpc = vi.fn();
    expect(
      await validateIntakeExport({ rpc } as unknown as Db, id, manifest),
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed if a download's access check fails", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "42501" }, data: null }));
    expect(
      await validateIntakeExport({ rpc } as unknown as Db, id, {
        version: 1,
        requests: [{ id, incarnation_id, export_revision }],
      }),
    ).toBe(false);
  });
});
describe("intake RPC failures", () => {
  it("retries only aborted transactions with exactly the same arguments", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: "40P01" } })
      .mockResolvedValueOnce({ error: { code: "40001" } })
      .mockResolvedValue({ error: null, data: { saved: true } });
    const args = { p_command: id };
    expect(
      (await intakeRpc({ rpc } as unknown as Db, "intake_cancel_request", args))
        .ok,
    ).toBe(true);
    expect(rpc.mock.calls).toEqual(
      Array.from({ length: 3 }, () => ["intake_cancel_request", args]),
    );
  });
  it.each([
    "P0002",
    "42501",
    "P0001",
    "23505",
    "P0004",
    "P0007",
    "22023",
    "23514",
    "22P02",
    "22007",
    "22008",
    "XX000",
    "40P01",
  ])("sanitizes database error %s", async (code) => {
    const rpc = vi.fn(async () => ({
      error: {
        code,
        message: "CONFIDENTIAL INPUT",
        details: "CONFIDENTIAL INPUT",
      },
    }));
    const result = await intakeRpc(
      { rpc } as unknown as Db,
      "intake_submit_request",
      {},
    );
    expect(result.ok).toBe(false);
    const codes: Record<string, string> = {
      P0001: "intake_conflict",
      P0004: "intake_purged",
      P0007: "intake_command_reused",
      "23505": "intake_command_reused",
    };
    if (codes[code])
      expect(result).toMatchObject({ ok: false, kind: "conflict", code: codes[code] });
    expect(JSON.stringify(result)).not.toContain("CONFIDENTIAL INPUT");
    expect(rpc).toHaveBeenCalledTimes(code === "40P01" ? 3 : 1);
  });
});
