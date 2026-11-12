import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), personalOrg: vi.fn() }));
vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: () => ({
    rpc: mocks.rpc,
    // The caller's personal organization, looked up for "personal" paths.
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mocks.personalOrg }) }),
      }),
    }),
  }),
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
  subject: "Subject",
  description: "Exact  text.\n",
  requester_name: "Jane Business",
};
const receipt = { request_id: id, applied_version: 1, replayed: false };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
describe("intake workspaces and the dashboard", () => {
  const personalOrg = "00000000-0000-4000-8000-000000000009";
  it("resolves Personal to the caller's own organization", async () => {
    mocks.personalOrg.mockResolvedValue({ data: { id: personalOrg }, error: null });
    mocks.rpc.mockResolvedValue({
      data: { requests: [], next_cursor: null },
      error: null,
    });
    const res = await request(app).get("/intake/personal/requests");
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "intake_list_requests",
      expect.objectContaining({ p_org: personalOrg, p_actor: "signed-in-user" }),
    );
  });
  it("makes a missing personal organization before using it", async () => {
    mocks.personalOrg.mockResolvedValue({ data: null, error: null });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "ensure_personal_organization"
        ? { data: personalOrg, error: null }
        : { data: [], error: null },
    );
    const res = await request(app).get("/intake/personal/members");
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ensure_personal_organization", {
      p_user_id: "signed-in-user",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("intake_members", {
      p_org: personalOrg,
      p_actor: "signed-in-user",
    });
  });
  it("rejects anything else in place of an organization", async () => {
    expect((await request(app).get("/intake/team/requests")).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads the dashboard in the viewer's timezone", async () => {
    mocks.rpc.mockResolvedValue({ data: { open: 0 }, error: null });
    const res = await request(app).get(
      `${path}/dashboard?timezone=Europe%2FStockholm`,
    );
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("intake_dashboard", {
      p_org: org,
      p_actor: "signed-in-user",
      p_timezone: "Europe/Stockholm",
      p_weeks: 8,
      p_created_days: 30,
      p_resolved_days: 30,
      p_median_days: 30,
    });
    await request(app).get(
      `${path}/dashboard?weeks=26&created_days=365&resolved_days=7&median_days=30`,
    );
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_weeks: 26,
      p_created_days: 365,
      p_resolved_days: 7,
      p_median_days: 30,
    });
    // Only the periods the menus offer are accepted.
    for (const query of ["weeks=52", "created_days=14", "median_days=7"])
      expect(
        (await request(app).get(`${path}/dashboard?${query}`)).status,
        query,
      ).toBe(400);
  });
});
describe("intake notifications", () => {
  const row = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    workspace: org,
    workspace_name: "Test legal",
    request_id: id < 3 ? id.toString() : "3",
    subject: "Supplier NDA",
    kind: "update",
    change: "note",
    actor_name: "Sam Colleague",
    automated: false,
    channel: null,
    created_at: `2026-11-04T10:00:0${id}Z`,
    ...extra,
  });
  it("hands the signed-in member their notifications from every workspace, one per request", async () => {
    mocks.rpc.mockResolvedValue({
      data: [row(1, { kind: "new_request", change: "assign" }), row(3), row(4, { change: "resolve" })],
      error: null,
    });
    const res = await request(app).post("/intake/notifications/claim");
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("intake_claim_notifications", {
      p_actor: "signed-in-user",
    });
    // No workspace is resolved: the claim covers them all.
    expect(mocks.personalOrg).not.toHaveBeenCalled();
    expect(res.body.notifications).toEqual([
      expect.objectContaining({ request_id: "1", kind: "new_request", change: "assign", more: 0 }),
      expect.objectContaining({ request_id: "3", kind: "update", change: "resolve", more: 1 }),
    ]);
  });
  it("reports an empty claim as no notifications", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await request(app).post("/intake/notifications/claim");
    expect(res.body).toEqual({ notifications: [] });
  });
  it("never sends a database failure to the client", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "relation intake_notifications is broken" },
    });
    const res = await request(app).post("/intake/notifications/claim");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("intake_notifications");
  });
});
describe("intake route contracts", () => {
  it("copies readable documents onto a request, refusing bad input before the database", async () => {
    const copy = `${path}/requests/${id}/documents/copy`;
    for (const body of [
      {},
      { document_ids: [] },
      { document_ids: ["not-a-uuid"] },
      { document_ids: [id], message_id: "nope" },
      { document_ids: [id], extra: true },
    ])
      expect((await request(app).post(copy).send(body)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    // A request the member cannot read is not found, and nothing is copied.
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(
      (await request(app).post(copy).send({ document_ids: [id] })).status,
    ).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith("intake_can_read", {
      p_org: org,
      p_actor: "signed-in-user",
      p_request: id,
    });
  });
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
      p_subject: "Subject",
      p_description: body.description,
      p_requester_name: "Jane Business",
      p_requester_email: null,
      p_requester_team: null,
      p_date: null,
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
    { requested_by_date: "2026-02-30" },
    // A request keeps no timezone, so one is an unknown field.
    { requested_by_date: "2026-12-01", timezone: "Europe/London" },
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
      "/requesters",
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
      `${path}/requests?assignee=unassigned&scope=overdue&search=nda&sort=updated&limit=1&timezone=Asia%2FTokyo`,
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
      p_scope: "overdue",
      p_requester: null,
      // Overdue is judged where the viewer is.
      p_timezone: "Asia/Tokyo",
      p_new_reply: false,
    });
    await request(app).get(`${path}/requests?requester=%20Jane%20Business%20`);
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_requester: "Jane Business",
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { requests: [], next: null },
      error: null,
    });
    const second = await request(app).get(
      `${path}/requests?cursor=${first.body.next_cursor}&limit=1`,
    );
    expect(second.body).toEqual({ requests: [], next_cursor: null });
    // A scope the dashboard does not count is refused before the database.
    expect(
      (await request(app).get(`${path}/requests?scope=late`)).status,
    ).toBe(400);
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_after_key: "2026-10-30T12:00:00+00:00",
      p_after_id: id,
    });
    const tampered = await request(app).get(`${path}/requests?cursor=abc`);
    expect(tampered.status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it("accepts any email the database accepts, such as a single-label domain", async () => {
    for (const requester_email of ["jane@localhost", "a@b"]) {
      const response = await request(app)
        .post(path + "/requests")
        .send({ ...details, id, command_id, requester_email });
      expect(response.status, requester_email).toBe(201);
      expect(mocks.rpc).toHaveBeenLastCalledWith(
        "intake_submit_request",
        expect.objectContaining({ p_requester_email: requester_email }),
      );
    }
  });

  it("forwards an edit with its expected version", async () => {
    const body = {
      ...details,
      requester_email: "jane@acme.test",
      requester_team: "Procurement",
      requested_by_date: "2026-12-01",
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
    // Without a resolution, p_body is still sent, as null, to match the function.
    ["resolve", "intake_resolve_request", { expected_version: 2 }, { p_version: 2, p_body: null }],
    ["cancel", "intake_cancel_request", { expected_version: 2, body: "Duplicate." }, { p_version: 2, p_body: "Duplicate." }],
    ["reopen", "intake_reopen_request", { expected_version: 2 }, { p_version: 2 }],
    ["delete", "intake_delete_request", { expected_version: 2 }, { p_version: 2 }],
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
    ["resolve", { expected_version: 2, body: "  " }],
    ["cancel", { expected_version: 2, body: "  " }],
    ["notes", { body: "Note", expected_version: 2 }],
    ["reopen", { expected_version: 2, body: "Why" }],
    ["delete", {}],
    ["delete", { expected_version: 2, body: "Why" }],
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
  it("marks replies seen up to the time the member was shown", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const seen = "2026-11-03T10:00:00.123456+00:00";
    const res = await request(app)
      .post(`${path}/requests/${id}/reply-seen`)
      .send({ seen_at: seen });
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("intake_mark_reply_seen", {
      p_org: org,
      p_actor: "signed-in-user",
      p_request: id,
      p_seen: seen,
    });
    // Without a time, every reply until now is seen.
    await request(app).post(`${path}/requests/${id}/reply-seen`).expect(200);
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_seen: null });
    mocks.rpc.mockClear();
    for (const body of [{ seen_at: "yesterday" }, { seen_at: seen, extra: 1 }])
      expect(
        (await request(app).post(`${path}/requests/${id}/reply-seen`).send(body)).status,
      ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
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

it("reads bounded delivery status with the authenticated actor and workspace", async () => {
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  expect((await request(app).post(`${path}/requests/${id}/deliveries/status`).send({ ids: [command_id] })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("intake_delivery_status", {
    p_org: org, p_actor: "signed-in-user", p_request: id, p_outbound: [command_id],
  });
  expect((await request(app).post(`${path}/requests/${id}/deliveries/status`).send({ ids: Array(101).fill(command_id) })).status).toBe(400);
});
