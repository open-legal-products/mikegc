import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbJob } from "../../lib/dbq/types";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_TEST_ANON_KEY;
// Uses real GoTrue tokens, route middleware, SQL transactions, queue runner and
// filesystem storage. No auth/database/worker mocks or external model calls.
describe.skipIf(!url || !key || !anon)(
  "intake authenticated stack and workers",
  () => {
    let db: SupabaseClient;
    const app = express();
    const org = randomUUID();
    const other = randomUUID();
    const users: { id: string; token: string; email: string }[] = [];
    let storageRoot = "";
    const path = `/intake/${org}`;
    const post = (actor: number, suffix: string, body: object) =>
      request(app)
        .post(path + suffix)
        .auth(users[actor].token, { type: "bearer" })
        .send(body);
    const get = (actor: number, suffix: string) =>
      request(app)
        .get(path + suffix)
        .auth(users[actor].token, { type: "bearer" });
    const input = () => ({
      id: randomUUID(),
      command_id: randomUUID(),
      category: "nda",
      subject: "Synthetic NDA",
      description: "Please review this request.",
      requester_name: "Jane Business",
      requester_email: "jane@business.test",
      requester_team: "Procurement",
    });
    beforeAll(async () => {
      vi.stubEnv("SUPABASE_URL", url!);
      vi.stubEnv("SUPABASE_SECRET_KEY", key!);
      vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", anon!);
      storageRoot = await mkdtemp(join(tmpdir(), "mikegc-intake-storage-"));
      vi.stubEnv("STORAGE_DRIVER", "fs");
      vi.stubEnv("STORAGE_FS_ROOT", storageRoot);
      db = createClient(url!, key!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      for (let i = 0; i < 6; i++) {
        const email = `intake-${randomUUID()}@test.local`;
        const password = `IntakeTest-${randomUUID()}!`;
        const created = await db.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (created.error || !created.data.user)
          throw created.error ?? new Error("No user");
        const login = await createClient(url!, anon!, {
          auth: { persistSession: false, autoRefreshToken: false },
        }).auth.signInWithPassword({ email, password });
        if (login.error || !login.data.session)
          throw login.error ?? new Error("No session");
        users.push({
          id: created.data.user.id,
          email,
          token: login.data.session.access_token,
        });
      }
      expect(
        (
          await db.from("organizations").insert([
            { id: org, name: "Synthetic Legal", created_by: users[0].id },
            { id: other, name: "Other Legal", created_by: users[5].id },
          ])
        ).error,
      ).toBeNull();
      expect(
        (
          await db.from("org_members").insert(
            users.map((u, i) => ({
              org_id: i === 5 ? other : org,
              user_id: u.id,
              role: i === 0 || i === 5 ? "owner" : i === 4 ? "admin" : "member",
            })),
          )
        ).error,
      ).toBeNull();
      const { intakeRouter } = await import(
        "../../modules/intake/intake.routes.js"
      );
      app.use(express.json());
      app.use("/intake", intakeRouter);
      expect((await get(2, "/members")).body).toHaveLength(5);
    }, 60000);
    afterAll(async () => {
      if (db) {
        expect(
          (await db.from("organizations").delete().in("id", [org, other]))
            .error,
        ).toBeNull();
        for (const u of users)
          expect((await db.auth.admin.deleteUser(u.id)).error).toBeNull();
      }
      if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }, 30000);
    it("enforces real authentication, hidden IDs and input validation", async () => {
      expect((await request(app).get(path + "/requests")).status).toBe(401);
      expect((await get(5, "/requests")).status).toBe(404);
      for (const extra of [
        { subject: " " },
        { requester_name: "" },
        { requester_email: "not-an-email" },
        { requested_by_date: "2026-02-30", timezone: "Europe/Stockholm" },
        { requested_by_date: "2026-10-26", timezone: "invalid" },
        { requester_id: users[0].id },
        { assignee_id: users[5].id },
      ]) {
        const response = await post(1, "/requests", { ...input(), ...extra });
        expect(response.status, JSON.stringify(extra)).toBe(400);
      }
      const body = input();
      expect((await post(1, "/requests", body)).status).toBe(201);
      const hidden = await get(5, `/requests/${body.id}`);
      expect(hidden.status).toBe(404);
      expect(hidden.body).not.toHaveProperty("description");
      // Every member is Legal, including admins and owners.
      for (const member of [0, 2, 4])
        expect((await get(member, `/requests/${body.id}`)).body).toMatchObject({
          requester_name: "Jane Business",
          requester_email: "jane@business.test",
        });
      const direct = createClient(url!, anon!, {
        global: { headers: { Authorization: `Bearer ${users[1].token}` } },
      });
      for (const table of [
        "settings",
        "requests",
        "messages",
        "events",
        "commands",
        "purged_commands",
      ])
        expect(
          (await direct.from(`intake_${table}`).select("*")).error,
        ).not.toBeNull();
      expect(
        (
          await direct.rpc("intake_get_request", {
            p_org: org,
            p_actor: users[2].id,
            p_request: body.id,
          })
        ).error,
      ).not.toBeNull();
    });
    it("reconciles a lost response and works a request through every command once", async () => {
      const body = input();
      await post(1, "/requests", body); // deliberately ignore the successful receipt
      const replay = await post(1, "/requests", body);
      expect(replay.status).toBe(200);
      expect(replay.body.replayed).toBe(true);
      const changed = await post(1, "/requests", { ...body, subject: "Changed" });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe("intake_command_reused");
      const action = (
        actor: number,
        name: string,
        fields: object = {},
      ) =>
        post(actor, `/requests/${body.id}/${name}`, {
          command_id: randomUUID(),
          ...fields,
        });
      expect(
        (await action(2, "assignment", { expected_version: 1, assignee_id: users[2].id }))
          .status,
      ).toBe(200);
      expect((await action(3, "notes", { body: "Called the supplier." })).status).toBe(200);
      expect(
        (await action(2, "wait", { expected_version: 2, body: "Asked Jane for the draft." }))
          .status,
      ).toBe(200);
      expect((await action(3, "resume", { expected_version: 3 })).status).toBe(200);
      const resolution = {
        command_id: randomUUID(),
        expected_version: 4,
        body: "Approved with edits.\nKeep this spacing.  ",
      };
      expect(
        (await post(4, `/requests/${body.id}/resolve`, resolution)).status,
      ).toBe(200);
      expect(
        (await post(4, `/requests/${body.id}/resolve`, resolution)).body.replayed,
      ).toBe(true);
      const messages = (await get(1, `/requests/${body.id}/messages`)).body;
      expect(messages.map((x: { kind: string; body: string }) => [x.kind, x.body])).toEqual([
        ["note", "Called the supplier."],
        ["note", "Asked Jane for the draft."],
        ["resolution", resolution.body],
      ]);
      expect((await get(1, `/requests/${body.id}`)).body).toMatchObject({
        state: "resolved",
        version: 5,
      });
      const stale = await action(1, "cancel", { expected_version: 5, body: "Too late" });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("intake_conflict");
      expect((await action(1, "reopen", { expected_version: 5 })).status).toBe(200);
      expect((await get(1, `/requests/${body.id}`)).body).toMatchObject({
        state: "in_review",
        version: 6,
        assignee_name: users[2].email,
      });
      const events = (await get(1, `/requests/${body.id}/events`)).body;
      expect(events.map((x: { kind: string }) => x.kind)).toEqual([
        "submitted",
        "assign",
        "wait",
        "resume",
        "resolve",
        "reopen",
      ]);
    });
    it("pages the queue by cursor", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const body = { ...input(), subject: `Pagination ${i}` };
        ids.push(body.id);
        expect((await post(1, "/requests", body)).status).toBe(201);
      }
      const rows: { id: string }[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await get(
          2,
          `/requests?search=Pagination&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(page.status).toBe(200);
        rows.push(...page.body.requests);
        cursor = page.body.next_cursor;
      } while (cursor);
      expect(rows.map((x) => x.id)).toEqual([...ids].reverse());
      expect(rows[0]).not.toHaveProperty("description");
      // Intake is always on: there is no switch to turn it off.
      expect((await get(0, "/configuration")).status).toBe(404);
    });
    it("unassigns a member deleted through the real Auth role while the organization is suspended", async () => {
      const created = await db.auth.admin.createUser({
        email: `intake-erasure-${randomUUID()}@test.local`,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const id = created.data.user!.id;
      const isolated = randomUUID();
      const requestId = randomUUID();
      try {
        expect(
          (
            await db.from("organizations").insert({
              id: isolated,
              name: "Suspended fixture",
              created_by: users[0].id,
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await db.from("org_members").insert([
              { org_id: isolated, user_id: users[0].id, role: "owner" },
              { org_id: isolated, user_id: id, role: "member" },
            ])
          ).error,
        ).toBeNull();
        expect(
          (
            await db.rpc("intake_submit_request", {
              p_org: isolated,
              p_actor: users[0].id,
              p_command: randomUUID(),
              p_request: requestId,
              p_category: "general",
              p_subject: "Retained",
              p_description: "Synthetic retained text",
              p_requester_name: "Sam Business",
              p_assignee: id,
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await db.rpc("soft_delete_organization", {
              p_org_id: isolated,
              p_actor_id: users[0].id,
            })
          ).error,
        ).toBeNull();
        // GoTrue runs the membership cascade as supabase_auth_admin.
        expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        expect(
          (
            await db
              .from("intake_requests")
              .select("assignee_id,state,description,requester_name")
              .eq("id", requestId)
              .single()
          ).data,
        ).toEqual({
          assignee_id: null,
          state: "submitted",
          description: "Synthetic retained text",
          requester_name: "Sam Business",
        });
      } finally {
        await db.from("organizations").delete().eq("id", isolated);
        await db.auth.admin.deleteUser(id);
      }
    });
    it("retains creator identity and receipts after storage failure, then erases them on worker retry", async () => {
      const created = await db.auth.admin.createUser({
        email: `intake-retry-${randomUUID()}@test.local`,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const user = created.data.user!;
      const requestId = randomUUID();
      const commandId = randomUUID();
      const { handleAccountDelete } = await import(
        "../../modules/user/user.accountJobs.js"
      );
      const { setStorageAdapter } = await import("../../lib/storage.js");
      const { createFilesystemStorageAdapter } = await import(
        "../../lib/storage/filesystem.js"
      );
      const filesystem = createFilesystemStorageAdapter();
      const job: DbJob = {
        id: randomUUID(),
        kind: "account.delete",
        payload: { userId: user.id, userEmail: user.email },
        status: "running",
        attempts: 1,
        max_attempts: 20,
        run_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        claimed_at: new Date().toISOString(),
        finished_at: null,
        last_error: null,
        dedupe_key: null,
        result: null,
      };
      let erased = false;
      try {
        expect(
          (
            await db
              .from("org_members")
              .insert({ org_id: org, user_id: user.id, role: "member" })
          ).error,
        ).toBeNull();
        expect(
          (
            await db.rpc("intake_submit_request", {
              p_org: org,
              p_actor: user.id,
              p_request: requestId,
              p_command: commandId,
              p_category: "general",
              p_subject: "Retry erasure",
              p_description: "Retained organization text",
              p_requester_name: "Sam Business",
            })
          ).error,
        ).toBeNull();
        setStorageAdapter({
          ...filesystem,
          async listFiles(prefix) {
            if (prefix === `exports/${user.id}/`)
              throw new Error("Synthetic storage failure");
            return filesystem.listFiles(prefix);
          },
        });
        await expect(handleAccountDelete(db, job)).rejects.toThrow(
          "Failed to list export artifacts",
        );
        setStorageAdapter(filesystem);
        expect((await db.auth.admin.getUserById(user.id)).data.user?.id).toBe(
          user.id,
        );
        const retained = await db
          .from("intake_requests")
          .select("created_by,export_revision")
          .eq("id", requestId)
          .single();
        expect(retained.error).toBeNull();
        expect(retained.data).toEqual({ created_by: user.id, export_revision: 1 });
        expect(
          (
            await db
              .from("intake_commands")
              .select("command_id")
              .eq("command_id", commandId)
          ).data,
        ).toEqual([{ command_id: commandId }]);
        await handleAccountDelete(db, job);
        erased = true;
        expect((await db.auth.admin.getUserById(user.id)).data.user).toBeNull();
        expect(
          (
            await db
              .from("intake_requests")
              .select("created_by,export_revision,description,requester_name")
              .eq("id", requestId)
              .single()
          ).data,
        ).toEqual({
          created_by: null,
          export_revision: 2,
          description: "Retained organization text",
          requester_name: "Sam Business",
        });
        expect(
          (
            await db
              .from("intake_commands")
              .select("command_id")
              .eq("command_id", commandId)
          ).data,
        ).toEqual([]);
      } finally {
        setStorageAdapter(filesystem);
        expect(
          (await db.from("intake_requests").delete().eq("id", requestId)).error,
        ).toBeNull();
        if (!erased)
          expect((await db.auth.admin.deleteUser(user.id)).error).toBeNull();
      }
    }, 60000);
    it("lets every member list and read a request's attachments, and removes them with the request", async () => {
      const body = input();
      expect((await post(1, "/requests", body)).status).toBe(201);
      const documentId = randomUUID();
      const versionId = randomUUID();
      expect(
        (
          await db.from("documents").insert({
            id: documentId,
            org_id: org,
            user_id: users[1].id,
            library_kind: "intake_attachment",
            status: "ready",
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await db.from("document_versions").insert({
            id: versionId,
            document_id: documentId,
            storage_path: `documents/${users[1].id}/${documentId}/nda.pdf`,
            version_number: 1,
            filename: "Supplier NDA.pdf",
            file_type: "pdf",
            size_bytes: 10,
          })
        ).error,
      ).toBeNull();
      await db
        .from("documents")
        .update({ current_version_id: versionId })
        .eq("id", documentId);
      expect(
        (
          await db.rpc("intake_attach_document", {
            p_org: org,
            p_actor: users[1].id,
            p_request: body.id,
            p_document: documentId,
          })
        ).error,
      ).toBeNull();
      const listed = await get(3, `/requests/${body.id}/documents`);
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([
        expect.objectContaining({
          document_id: documentId,
          filename: "Supplier NDA.pdf",
          added_by_name: users[1].email,
        }),
      ]);
      expect((await get(5, `/requests/${body.id}/documents`)).status).toBe(404);
      for (const [user, readable] of [
        [3, true],
        [5, false],
      ] as const)
        expect(
          (
            await db.rpc("org_private_document_access", {
              p_org_id: org,
              p_document_id: documentId,
              p_user_id: users[user].id,
            })
          ).data,
        ).toBe(readable);
      expect(
        (await db.from("intake_requests").delete().eq("id", body.id)).error,
      ).toBeNull();
      expect(
        (await db.from("documents").select("id").eq("id", documentId)).data,
      ).toEqual([]);
    });
    it("keeps intake out of new account exports and still checks older intake manifests", async () => {
      const { startUserExport, loadUserExportArtifact } = await import(
        "../../modules/user/user.export.js"
      );
      const { handleExportBuild } = await import(
        "../../modules/user/user.exportJobs.js"
      );
      const { processClaimedJob } = await import("../../lib/dbq/runner.js");
      const legacyId = randomUUID();
      let exportId = "";
      try {
        // A request from before the tracker, listed in an older export.
        expect(
          (
            await db.from("intake_requests").insert({
              id: legacyId,
              org_id: org,
              requester_id: users[3].id,
              created_by: users[3].id,
              requester_name: users[3].email,
              category: "general",
              subject: "Legacy export fixture",
              description: "Retained request",
            })
          ).error,
        ).toBeNull();
        const started = await startUserExport(db, {
          userId: users[3].id,
          type: "account",
          payload: { userId: users[3].id, userEmail: users[3].email, type: "account" },
        });
        expect(started.ok).toBe(true);
        if (!started.ok) throw new Error(started.detail);
        exportId = started.exportId;
        const claimed = await db.rpc("claim_db_job", {
          p_id: exportId,
          p_stale_seconds: 600,
        });
        expect(claimed.error).toBeNull();
        const job = (claimed.data as DbJob[]).find((x) => x.id === exportId);
        await processClaimedJob(db, { "export.build": handleExportBuild }, job!);
        const stored = await db
          .from("db_jobs")
          .select("status,result")
          .eq("id", exportId)
          .single();
        expect(stored.data?.status, JSON.stringify(stored.data)).toBe("done");
        expect(stored.data!.result).not.toHaveProperty("intake_manifest");
        const current = await loadUserExportArtifact(db, exportId, users[3].id);
        expect(current.ok).toBe(true);
        if (!current.ok) throw new Error(current.kind);
        expect(JSON.parse(current.body.toString())).not.toHaveProperty("intake");
        expect(current.body.toString()).not.toContain("Legacy export fixture");
        // Mark the same artifact as an older one that listed the legacy request.
        const legacy = await db
          .from("intake_requests")
          .select("incarnation_id,export_revision")
          .eq("id", legacyId)
          .single();
        expect(
          (
            await db
              .from("db_jobs")
              .update({
                result: {
                  ...stored.data!.result,
                  intake_format: 1,
                  intake_manifest: {
                    version: 1,
                    requests: [{ id: legacyId, ...legacy.data }],
                  },
                },
              })
              .eq("id", exportId)
          ).error,
        ).toBeNull();
        expect((await loadUserExportArtifact(db, exportId, users[3].id)).ok).toBe(
          true,
        );
        expect(
          (
            await db.rpc("remove_org_member", {
              p_org_id: org,
              p_user_id: users[3].id,
              p_actor_id: users[0].id,
            })
          ).error,
        ).toBeNull();
        expect(await loadUserExportArtifact(db, exportId, users[3].id)).toEqual({
          ok: false,
          kind: "expired",
        });
        expect((await get(3, "/requests")).status).toBe(404);
      } finally {
        if (exportId)
          expect((await db.from("db_jobs").delete().eq("id", exportId)).error).toBeNull();
        expect(
          (await db.from("intake_requests").delete().eq("id", legacyId)).error,
        ).toBeNull();
      }
    }, 60000);
  },
);
