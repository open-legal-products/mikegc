import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../../../middleware/auth", () => ({
  requireAuth: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.userId = "signed-in-user";
    next();
  },
}));
import { intakeRouter } from "../intake.routes";
const app = express();
app.use(express.json());
app.use("/intake", intakeRouter);
const org = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const command_id = "00000000-0000-4000-8000-000000000003";
const path = `/intake/${org}`;
const details = {
  category: "general",
  subject: "Subject",
  description: "Exact  text.\n",
  requester_name: "Jane Business",
};
const receipt = { request_id: id, applied_version: 1, replayed: false };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
describe("intake route contracts", () => {
  it("takes identity from authentication and rejects client-supplied actor fields", async () => {
    const body = { ...details, id, command_id };
    expect(
      (
        await request(app)
          .post(path + "/requests")
          .send({ ...body, p_actor: "other" })
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await request(app).post(path + "/requests").send(body)).status).toBe(
      201,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("intake_submit_request", {
      p_org: org,
      p_actor: "signed-in-user",
      p_request: id,
      p_command: command_id,
      p_category: "general",
      p_subject: "Subject",
      p_description: body.description,
      p_requester_name: "Jane Business",
      p_requester_email: null,
      p_requester_team: null,
      p_date: null,
      p_timezone: null,
      p_assignee: null,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { ...receipt, replayed: true },
      error: null,
    });
    expect((await request(app).post(path + "/requests").send(body)).status).toBe(
      200,
    );
  });
  it.each([
    { requester_name: "  " },
    { requester_name: undefined },
    { requester_email: "not an email" },
    { requested_by_date: "2026-12-01" },
    { requested_by_date: "2026-12-01", timezone: "Mars/Base" },
    { assignee_id: "not-a-uuid" },
  ])("rejects invalid request details %j", async (change) => {
    const body = { ...details, id, command_id, ...change };
    expect((await request(app).post(path + "/requests").send(body)).status).toBe(
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates bounded reads and binds every read to the authenticated scope", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    for (const suffix of [
      "/members",
      `/requests/${id}`,
      `/requests/${id}/messages`,
      `/requests/${id}/events?offset=100&limit=100`,
    ]) {
      expect((await request(app).get(path + suffix)).status).toBe(200);
      expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
        p_org: org,
        p_actor: "signed-in-user",
      });
    }
    for (const suffix of [
      "/requests?limit=101",
      "/requests?assignee=someone",
      "/requests?sort=oldest",
      "/requests?state=open",
      "/requests?category=nda,general",
      `/requests/${id}/messages?limit=101`,
      `/requests/${id}/events?offset=-1`,
      "/requests/not-a-uuid",
    ])
      expect((await request(app).get(path + suffix)).status).toBe(400);
    expect((await request(app).get("/intake/invalid/members")).status).toBe(400);
  });
  it("pages the queue with an opaque keyset cursor", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        requests: [{ id }],
        next: { key: "2026-10-30T12:00:00+00:00", id },
      },
      error: null,
    });
    const first = await request(app).get(
      `${path}/requests?assignee=unassigned&search=nda&sort=updated&limit=1`,
    );
    expect(first.status).toBe(200);
    expect(first.body.requests).toEqual([{ id }]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("intake_list_requests", {
      p_org: org,
      p_actor: "signed-in-user",
      p_state: null,
      p_assignee: "unassigned",
      p_search: "nda",
      p_sort: "updated",
      p_after_key: null,
      p_after_id: null,
      p_limit: 1,
      p_category: null,
    });
    await request(app).get(`${path}/requests?category=nda`);
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_category: "nda",
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { requests: [], next: null },
      error: null,
    });
    const second = await request(app).get(
      `${path}/requests?cursor=${first.body.next_cursor}&limit=1`,
    );
    expect(second.body).toEqual({ requests: [], next_cursor: null });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_after_key: "2026-10-30T12:00:00+00:00",
      p_after_id: id,
    });
    const tampered = await request(app).get(`${path}/requests?cursor=abc`);
    expect(tampered.status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it("forwards an edit with its expected version", async () => {
    const body = {
      ...details,
      requester_email: "jane@acme.test",
      requester_team: "Procurement",
      requested_by_date: "2026-12-01",
      timezone: "Europe/London",
      command_id,
      expected_version: 3,
    };
    expect(
      (await request(app).patch(`${path}/requests/${id}`).send(body)).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "intake_edit_request",
      expect.objectContaining({
        p_request: id,
        p_version: 3,
        p_requester_email: "jane@acme.test",
        p_date: "2026-12-01",
        p_timezone: "Europe/London",
      }),
    );
    expect(
      (
        await request(app)
          .patch(`${path}/requests/${id}`)
          .send({ ...body, expected_version: undefined })
      ).status,
    ).toBe(400);
  });
  it.each([
    ["assignment", "intake_assign_request", { expected_version: 2, assignee_id: id }, { p_version: 2, p_assignee: id }],
    ["notes", "intake_note_request", { body: "Called Jane." }, { p_body: "Called Jane." }],
    ["wait", "intake_wait_request", { expected_version: 2 }, { p_version: 2 }],
    ["resume", "intake_resume_request", { expected_version: 2, body: "Jane replied." }, { p_version: 2, p_body: "Jane replied." }],
    ["resolve", "intake_resolve_request", { expected_version: 2, body: "Approved." }, { p_version: 2, p_body: "Approved." }],
    ["cancel", "intake_cancel_request", { expected_version: 2, body: "Duplicate." }, { p_version: 2, p_body: "Duplicate." }],
    ["reopen", "intake_reopen_request", { expected_version: 2 }, { p_version: 2 }],
  ])(
    "forwards a %s command with only its declared arguments",
    async (action, rpc, fields, args) => {
      const body = { command_id, ...fields };
      expect(
        (await request(app).post(`${path}/requests/${id}/${action}`).send(body))
          .status,
      ).toBe(200);
      expect(mocks.rpc).toHaveBeenLastCalledWith(rpc, {
        p_org: org,
        p_actor: "signed-in-user",
        p_request: id,
        p_command: command_id,
        ...args,
      });
      expect(
        (
          await request(app)
            .post(`${path}/requests/${id}/${action}`)
            .send({ ...body, actor_id: id })
        ).status,
      ).toBe(400);
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002" } });
      const hidden = await request(app)
        .post(`${path}/requests/${id}/${action}`)
        .send(body);
      expect(hidden.status).toBe(404);
      expect(hidden.body).not.toHaveProperty("request_id");
    },
  );
  it.each([
    ["resolve", { expected_version: 2 }],
    ["cancel", { expected_version: 2, body: "  " }],
    ["notes", { body: "Note", expected_version: 2 }],
    ["reopen", { expected_version: 2, body: "Why" }],
  ])("rejects a malformed %s command", async (action, fields) => {
    expect(
      (
        await request(app)
          .post(`${path}/requests/${id}/${action}`)
          .send({ command_id, ...fields })
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("has no requester-facing, roster or on/off endpoints", async () => {
    for (const action of ["questions", "replies", "answer"])
      expect(
        (
          await request(app)
            .post(`${path}/requests/${id}/${action}`)
            .send({ command_id, expected_version: 1, body: "Text" })
        ).status,
      ).toBe(404);
    expect((await request(app).get(path + "/reviewers")).status).toBe(404);
    expect((await request(app).get(path + "/configuration")).status).toBe(404);
    expect(
      (
        await request(app)
          .put(path + "/configuration")
          .send({ command_id, expected_revision: 0, enabled: false })
      ).status,
    ).toBe(404);
  });
  it("returns scoped failures from reads and creation", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    for (const suffix of [
      "/members",
      "/requests",
      `/requests/${id}`,
      `/requests/${id}/messages`,
    ])
      expect((await request(app).get(path + suffix)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(path + "/requests")
          .send({ ...details, id, command_id })
      ).status,
    ).toBe(403);
  });
});
