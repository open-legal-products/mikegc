import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_intake_${process.pid}_${Date.now()}`;
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const args = () => [
  "exec",
  "-i",
  container!,
  "psql",
  "-U",
  "postgres",
  "-d",
  database,
  "-v",
  "ON_ERROR_STOP=1",
  "-XqAt",
];
// Verbose errors include the SQLSTATE, so tests can tell conflicts apart.
const sql = (input: string) =>
  execFileSync("docker", args(), {
    input: `\\set VERBOSITY verbose\n${input}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const json = (query: string) => JSON.parse(sql(query));
const migration = (name: string) =>
  readFileSync(resolve(`migrations/${name}`), "utf8");
/** A versioned command wrapper, e.g. intake_resolve_request. */
const cmd = (
  name: string,
  actor: number,
  command: number,
  version: number,
  extra = "",
  request = 20,
) =>
  `select public.intake_${name}_request(${q(10)},${q(actor)},${q(command)},${q(request)},${version}${extra});`;
const note = (actor: number, command: number, body: string, request = 20) =>
  `select public.intake_note_request(${q(10)},${q(actor)},${q(command)},${q(request)},'${body}');`;
const submit = (
  command = 100,
  {
    actor = 2,
    request = 20,
    subject = "Supplier NDA",
    requester = "Jane Business",
    team = "'Procurement'",
    date = "null",
    timezone = "null",
    assignee = "null",
  } = {},
) =>
  `select public.intake_submit_request(${q(10)},${q(actor)},${q(command)},${q(request)},'nda','${subject}','Please review',` +
  `'${requester}','jane@acme.test',${team},${date},${timezone},${assignee});`;
const state = (request = 20) =>
  sql(
    `select state||':'||version||':'||coalesce(assignee_id::text,'-') from public.intake_requests where id=${q(request)}`,
  );
const list = (actor: number, extra = "") =>
  json(`select public.intake_list_requests(${q(10)},${q(actor)}${extra});`);
const parallel = (input: string) =>
  new Promise<{ code: number | null; out: string }>((resolveResult) => {
    const p = spawn("docker", args());
    let out = "";
    p.stdout.on("data", (x) => {
      out += x;
    });
    p.stderr.on("data", (x) => {
      out += x;
    });
    p.on("close", (code) => resolveResult({ code, out }));
    p.stdin.end(input);
  });
describe.skipIf(!container)("intake real PostgreSQL transactions", () => {
  beforeAll(() => {
    execFileSync("docker", [
      "exec",
      container!,
      "createdb",
      "-U",
      "postgres",
      database,
    ]);
    sql(
      "create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());",
    );
    sql(readFileSync(resolve("schema.sql"), "utf8"));
    // The tracker migration is safe to re-run over the final shape.
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    sql(migration("20261030_03_intake_attachments.sql"));
    sql(migration("20261030_03_intake_attachments.sql"));
  }, 60000);
  afterAll(() => {
    execFileSync("docker", [
      "exec",
      container!,
      "dropdb",
      "-U",
      "postgres",
      "--force",
      database,
    ]);
  });
  beforeEach(() => {
    sql(`truncate auth.users,public.organizations,public.db_jobs cascade;
      insert into auth.users(id,email) values ${[1, 2, 3, 4, 5, 6].map((n) => `(${q(n)},'person${n}@example.test')`).join(",")};
      insert into public.organizations(id,name,created_by) values(${q(10)},'Test legal',${q(1)}),(${q(11)},'Other',${q(6)});
      insert into public.org_members(org_id,user_id,role) values(${q(10)},${q(1)},'owner'),(${q(10)},${q(2)},'member'),(${q(10)},${q(3)},'member'),(${q(10)},${q(4)},'member'),(${q(10)},${q(5)},'admin'),(${q(11)},${q(6)},'owner');`);
  });
  it("keeps Auth lifecycle trigger execution under a trusted owner", () => {
    // Supabase's postgres role is not a superuser, so require an owner that
    // can read auth.users and is not one of the API roles.
    expect(
      sql(`select count(*) from pg_proc p join pg_roles r on r.oid=p.proowner
      where p.oid='public.cleanup_removed_org_member_overrides()'::regprocedure
      and p.prosecdef
      and r.rolname not in ('anon','authenticated','service_role','supabase_auth_admin')
      and has_table_privilege(r.oid,'auth.users','SELECT')
      and 'search_path=pg_catalog, public, pg_temp'=any(p.proconfig)`),
    ).toBe("1");
    // GoTrue deletes cascade into memberships; unassignment runs as its owner.
    expect(
      sql(`select count(*) from pg_proc p join pg_roles r on r.oid=p.proowner
      where p.oid='public.intake_member_departure()'::regprocedure
      and p.prosecdef
      and r.rolname not in ('anon','authenticated','service_role','supabase_auth_admin')
      and 'search_path=pg_catalog, public, pg_temp'=any(p.proconfig)`),
    ).toBe("1");
    for (const role of ["anon", "authenticated", "service_role"])
      expect(
        sql(`select has_schema_privilege('${role}','public','CREATE')`),
      ).toBe("f");
  });
  it("records a request for a named requester and works it to resolution once", () => {
    expect(json(submit()).applied_version).toBe(1);
    expect(
      json(`select public.intake_get_request(${q(10)},${q(3)},${q(20)});`),
    ).toMatchObject({
      requester_name: "Jane Business",
      requester_email: "jane@acme.test",
      requester_team: "Procurement",
      created_by_name: "person2@example.test",
      state: "submitted",
    });
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    expect(state()).toBe(`in_review:2:${uid(3)}`);
    sql(note(4, 102, "Called the supplier"));
    expect(state()).toBe(`in_review:2:${uid(3)}`);
    sql(cmd("wait", 3, 103, 2, ",'Asked Jane for the draft'"));
    expect(state()).toBe(`needs_information:3:${uid(3)}`);
    sql(cmd("resume", 3, 104, 3));
    expect(state()).toBe(`in_review:4:${uid(3)}`);
    const resolve = cmd("resolve", 3, 105, 4, ",'Approved with edits.\nSecond line.'");
    expect(json(resolve).applied_version).toBe(5);
    expect(json(resolve).replayed).toBe(true);
    expect(state()).toBe(`resolved:5:${uid(3)}`);
    expect(
      sql(
        "select string_agg(kind,',' order by created_at,id) from public.intake_messages",
      ),
    ).toBe("note,note,resolution");
    expect(
      sql("select body from public.intake_messages where kind='resolution'"),
    ).toBe("Approved with edits.\nSecond line.");
    sql(cmd("reopen", 4, 106, 5));
    expect(state()).toBe(`in_review:6:${uid(3)}`);
    expect(() => sql(cmd("cancel", 4, 107, 6, ",null"))).toThrow(/22023/);
    sql(cmd("cancel", 4, 108, 6, ",'Duplicate of another request'"));
    expect(state()).toBe(`cancelled:7:${uid(3)}`);
    expect(
      sql("select kind from public.intake_messages order by created_at desc,id desc limit 1"),
    ).toBe("cancel_reason");
  });
  it("lets every member act and keeps outsiders out", () => {
    sql(submit(100, { assignee: q(4) }));
    expect(state()).toBe(`in_review:1:${uid(4)}`);
    // Neither the assignee nor an owner role is required.
    sql(cmd("resolve", 5, 101, 1, ",'Handled by the admin'"));
    expect(state()).toBe(`resolved:2:${uid(4)}`);
    expect(list(5).requests).toHaveLength(1);
    for (const outsider of [6])
      expect(() =>
        sql(`select public.intake_get_request(${q(10)},${q(outsider)},${q(20)});`),
      ).toThrow(/P0002/);
    expect(() => sql(note(6, 102, "Outsider"))).toThrow(/P0002/);
    expect(() => list(6)).toThrow(/P0002/);
    expect(() => sql(submit(103, { request: 21, assignee: q(6) }))).toThrow(
      /22023/,
    );
    expect(
      json(`select public.intake_members(${q(10)},${q(2)});`).map(
        (m: { user_id: string }) => m.user_id,
      ),
    ).toEqual([1, 2, 3, 4, 5].map(uid));
  });
  it("adds notes without a version, including after resolution", () => {
    sql(submit());
    sql(note(3, 101, "First"));
    sql(note(4, 102, "Second"));
    expect(json(note(4, 102, "Second")).replayed).toBe(true);
    expect(state()).toBe("submitted:1:-");
    sql(cmd("resolve", 3, 103, 1, ",'Done'"));
    expect(json(note(4, 104, "Follow-up after resolution")).applied_version).toBe(2);
    expect(sql("select count(*) from public.intake_messages where kind='note'")).toBe("3");
    expect(() => sql(note(4, 105, "   "))).toThrow(/22023/);
  });
  it("tells reused commands and stale versions apart", () => {
    sql(submit());
    expect(json(submit()).replayed).toBe(true);
    expect(() => sql(submit().replace("Please review", "Different"))).toThrow(
      /P0007/,
    );
    expect(() => sql(submit(101))).toThrow(/P0007/);
    sql(cmd("assign", 3, 102, 1, `,${q(3)}`));
    expect(() => sql(cmd("assign", 4, 103, 1, `,${q(4)}`))).toThrow(/P0001/);
    expect(() => sql(cmd("resume", 4, 104, 2))).toThrow(/P0001/);
    expect(
      sql("select count(*) from public.intake_events where request_id is not null"),
    ).toBe("2");
  });
  it("rolls back state and messages when history insertion fails", () => {
    sql(submit());
    sql(
      "alter table public.intake_events add constraint test_reject_resolve check(kind <> 'resolve');",
    );
    try {
      expect(() => sql(cmd("resolve", 3, 101, 1, ",'Never committed'"))).toThrow();
      expect(state()).toBe("submitted:1:-");
      expect(sql("select count(*) from public.intake_messages")).toBe("0");
    } finally {
      sql("alter table public.intake_events drop constraint test_reject_resolve");
    }
  });
  it("rolls back resolution, history and state when receipt insertion fails", () => {
    sql(submit());
    sql(
      "alter table public.intake_commands add constraint test_reject_resolve_receipt check(action <> 'resolve');",
    );
    try {
      expect(() => sql(cmd("resolve", 3, 101, 1, ",'Never committed'"))).toThrow();
      expect(state()).toBe("submitted:1:-");
      expect(sql("select count(*) from public.intake_messages")).toBe("0");
      expect(
        sql("select count(*) from public.intake_events where kind='resolve'"),
      ).toBe("0");
    } finally {
      sql(
        "alter table public.intake_commands drop constraint test_reject_resolve_receipt",
      );
    }
    expect(json(cmd("resolve", 3, 101, 1, ",'Never committed'")).applied_version).toBe(2);
  });
  it("unassigns a departing member's open work and reopens without them", () => {
    sql(submit());
    sql(submit(101, { request: 21, subject: "Second" }));
    sql(cmd("assign", 3, 102, 1, `,${q(3)}`));
    sql(cmd("assign", 3, 103, 1, `,${q(3)}`, 21));
    sql(cmd("resolve", 3, 104, 2, ",'Done'", 21));
    sql(`select public.remove_org_member(${q(10)},${q(3)},${q(1)});`);
    expect(state()).toBe("submitted:3:-");
    expect(state(21)).toBe(`resolved:3:${uid(3)}`);
    const events = json(
      `select public.intake_read_history(${q(10)},${q(2)},${q(20)},true);`,
    );
    expect(events.at(-1)).toMatchObject({
      kind: "assignee_left",
      actor_name: null,
      assignee_name: "person3@example.test",
    });
    expect(() => sql(cmd("assign", 2, 105, 3, `,${q(3)}`))).toThrow(/22023/);
    sql(cmd("reopen", 2, 106, 3, "", 21));
    expect(state(21)).toBe("submitted:4:-");
  });
  it("is always on and saves an organization's intake anchor with its first request", () => {
    expect(
      sql(`select count(*) from public.intake_settings where org_id=${q(11)}`),
    ).toBe("0");
    expect(
      json(
        `select public.intake_submit_request(${q(11)},${q(6)},${q(130)},${q(31)},'general','Question','Please help','Sam');`,
      ).request_id,
    ).toBe(uid(31));
    expect(
      sql(`select count(*) from public.intake_settings where org_id=${q(11)}`),
    ).toBe("1");
    expect(
      sql("select count(*) from pg_proc where proname in ('intake_configure','intake_configuration')"),
    ).toBe("0");
  });
  it("edits open requests with history and validates details", () => {
    sql(submit());
    const edit = (command: number, version: number, email = "'sam@acme.test'", date = "'2026-12-01'", timezone = "'Europe/London'") =>
      `select public.intake_edit_request(${q(10)},${q(3)},${q(command)},${q(20)},${version},'general','Renamed','Updated text','Sam Business',${email},null,${date},${timezone});`;
    expect(json(edit(101, 1)).applied_version).toBe(2);
    expect(
      json(`select public.intake_get_request(${q(10)},${q(4)},${q(20)});`),
    ).toMatchObject({
      category: "general",
      subject: "Renamed",
      requester_name: "Sam Business",
      requester_email: "sam@acme.test",
      requester_team: null,
      requested_by_date: "2026-12-01",
      timezone: "Europe/London",
    });
    expect(sql("select kind from public.intake_events order by id desc limit 1")).toBe("edited");
    expect(() => sql(edit(102, 2, "'not an email'"))).toThrow(/22023/);
    expect(() => sql(edit(103, 2, "null", "'2026-12-01'", "'Mars/Base'"))).toThrow(/22023/);
    expect(() => sql(edit(104, 2, "null", "'2026-12-01'", "null"))).toThrow(/22023/);
    sql(cmd("resolve", 3, 105, 2, ",'Done'"));
    expect(() => sql(edit(106, 3))).toThrow(/P0001/);
  });
  it("filters, searches and pages the queue without repeating rows", () => {
    sql(submit(100, { request: 20, subject: "First", date: "'2026-12-10'", timezone: "'UTC'" }));
    sql(submit(101, { request: 21, subject: "Second", team: "'Marketing'", assignee: q(3) }));
    sql(submit(102, { request: 22, subject: "Third", date: "'2026-11-05'", timezone: "'UTC'", assignee: q(4) }));
    const ids = (page: { requests: { id: string }[] }) =>
      page.requests.map((r) => r.id);
    expect(ids(list(2))).toEqual([22, 21, 20].map(uid));
    expect(ids(list(2, ",null,'unassigned'"))).toEqual([uid(20)]);
    expect(ids(list(3, ",null,'me'"))).toEqual([uid(21)]);
    expect(ids(list(2, `,null,'${uid(4)}'`))).toEqual([uid(22)]);
    expect(ids(list(2, ",'in_review'"))).toEqual([22, 21].map(uid));
    sql(`update public.intake_requests set category='general' where id=${q(21)}`);
    expect(ids(list(2, ",null,null,'','updated',null,null,50,'general'"))).toEqual([uid(21)]);
    expect(ids(list(2, ",null,null,'','updated',null,null,50,'nda'"))).toEqual([22, 20].map(uid));
    expect(() => list(2, ",null,null,'','updated',null,null,50,'contract'")).toThrow(/22023/);
    expect(ids(list(2, ",null,null,'marketing'"))).toEqual([uid(21)]);
    expect(ids(list(2, ",null,null,'jane@acme'"))).toHaveLength(3);
    expect(ids(list(2, ",null,null,'','target'"))).toEqual([22, 20, 21].map(uid));
    expect(list(2).requests[0]).not.toHaveProperty("description");
    // Updated order: page one, then a new request arrives before page two.
    const first = list(2, ",null,null,'','updated',null,null,2");
    expect(ids(first)).toEqual([22, 21].map(uid));
    sql(submit(103, { request: 23, subject: "Fourth" }));
    const second = list(
      2,
      `,null,null,'','updated','${first.next.key}','${first.next.id}',2`,
    );
    expect(ids(second)).toEqual([uid(20)]);
    expect(second.next).toBeNull();
    // Target order keeps undated requests last across pages.
    const t1 = list(2, ",null,null,'','target',null,null,2");
    expect(ids(t1)).toEqual([22, 20].map(uid));
    const t2 = list(2, `,null,null,'','target','${t1.next.key}','${t1.next.id}',2`);
    expect(t2.requests.map((r: { requested_by_date: string | null }) => r.requested_by_date)).toEqual([null, null]);
    const t3 = t2.next
      ? list(2, `,null,null,'','target',null,'${t2.next.id}',2`)
      : { requests: [] };
    expect(t3.requests).toEqual([]);
    expect(() => list(2, ",'bogus'")).toThrow(/22023/);
    expect(() => list(2, ",null,'not-a-uuid'")).toThrow(/22P02/);
  });
  it("keeps requests after the creator leaves and erases identity on account deletion", () => {
    sql(submit());
    sql(`select public.remove_org_member(${q(10)},${q(2)},${q(1)});`);
    expect(() =>
      sql(`select public.intake_get_request(${q(10)},${q(2)},${q(20)});`),
    ).toThrow(/P0002/);
    expect(
      json(`select public.intake_get_request(${q(10)},${q(3)},${q(20)});`)
        .description,
    ).toBe("Please review");
    sql(`delete from auth.users where id=${q(2)};`);
    expect(
      sql("select created_by is null and requester_name='Jane Business' from public.intake_requests"),
    ).toBe("t");
    expect(
      sql(`select count(*) from public.intake_commands where actor_id=${q(2)}`),
    ).toBe("0");
  });
  it("returns an erased assignee's open work to the queue", () => {
    sql(submit());
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    sql(`delete from auth.users where id=${q(3)};`);
    expect(state()).toBe("submitted:3:-");
    expect(
      sql("select count(*) from public.intake_events where kind='assignee_left'"),
    ).toBe("1");
    expect(
      sql(`select count(*) from public.intake_commands where input->>'assignee'=${q(3)}`),
    ).toBe("0");
  });
  it("denies browser roles both table and function access", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(() =>
        sql(`set role ${role}; select * from public.intake_requests;`),
      ).toThrow();
      expect(() =>
        sql(`set role ${role}; select * from public.intake_purged_commands;`),
      ).toThrow();
      expect(() => sql(`set role ${role}; ${submit()}`)).toThrow();
    }
  });
  it("hides soft-deleted organizations, restores and cascades hard deletion", () => {
    sql(submit());
    sql(`select public.soft_delete_organization(${q(10)},${q(1)})`);
    expect(() =>
      sql(`select public.intake_get_request(${q(10)},${q(2)},${q(20)})`),
    ).toThrow();
    sql(`select public.restore_organization(${q(10)},${q(1)})`);
    expect(
      json(`select public.intake_get_request(${q(10)},${q(2)},${q(20)})`).id,
    ).toBe(uid(20));
    sql(`delete from public.organizations where id=${q(10)}`);
    for (const table of [
      "settings",
      "requests",
      "messages",
      "events",
      "commands",
      "purged_commands",
    ])
      expect(sql(`select count(*) from public.intake_${table}`)).toBe("0");
  });
  it("serializes simultaneous submissions and conflicting assignments", async () => {
    const created = await Promise.all([parallel(submit()), parallel(submit())]);
    expect(created.map((x) => x.code)).toEqual([0, 0]);
    expect(sql("select count(*) from public.intake_requests")).toBe("1");
    const assigned = await Promise.all([
      parallel(cmd("assign", 3, 101, 1, `,${q(3)}`)),
      parallel(cmd("assign", 4, 102, 1, `,${q(4)}`)),
    ]);
    expect(assigned.filter((x) => x.code === 0)).toHaveLength(1);
    expect(
      sql("select count(*) from public.intake_events where kind='assign'"),
    ).toBe("1");
  });
  async function waitUntilLocked(marker: number) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (
        sql(
          `select count(*) from pg_locks where locktype='advisory' and objid=${marker} and granted`,
        ) === "1"
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Concurrent transaction never reached the lock barrier");
  }
  it("rejects a stale resolution when a concurrent departure commits first", async () => {
    sql(submit());
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    const marker = 700000 + process.pid;
    const departure = parallel(
      `begin; select public.remove_org_member(${q(10)},${q(3)},${q(1)}); select pg_advisory_xact_lock(${marker}); select pg_sleep(1); commit;`,
    );
    await waitUntilLocked(marker);
    const resolved = await parallel(cmd("resolve", 4, 102, 2, ",'Stale view'"));
    expect((await departure).code).toBe(0);
    expect(resolved.code).not.toBe(0);
    expect(sql("select count(*) from public.intake_messages")).toBe("0");
    expect(state()).toBe("submitted:3:-");
  });
  it("keeps exactly one resolution when it commits before a departure", async () => {
    sql(submit());
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    const marker = 800000 + process.pid;
    const resolved = parallel(
      `begin; ${cmd("resolve", 3, 102, 2, ",'Committed resolution'")} select pg_advisory_xact_lock(${marker}); select pg_sleep(1); commit;`,
    );
    await waitUntilLocked(marker);
    const departed = await parallel(
      `select public.remove_org_member(${q(10)},${q(3)},${q(1)})`,
    );
    expect((await resolved).code).toBe(0);
    expect(departed.code).toBe(0);
    expect(state()).toBe(`resolved:3:${uid(3)}`);
    expect(
      sql(
        "select count(*) from public.intake_messages where body='Committed resolution'",
      ),
    ).toBe("1");
  });
  // Older account exports listed the caller's own requests by requester_id.
  const legacy = () =>
    sql("update public.intake_requests set requester_id=created_by");
  it("does not revive an older export after purge and reuse of the request ID", () => {
    sql(submit());
    legacy();
    const incarnation = sql(
      "select incarnation_id from public.intake_requests",
    );
    const check = `select public.intake_validate_export(${q(2)},'[ {"id":"${uid(20)}","incarnation_id":"${incarnation}","export_revision":1} ]'::jsonb)`;
    expect(sql(check)).toBe("t");
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(sql(check)).toBe("f");
    sql(submit(150));
    legacy();
    expect(sql(check)).toBe("f");
  });
  it.each(["requester", "assignee", "message", "event_actor", "event_assignee"])(
    "invalidates older exports for erased %s identity without replacing the request",
    (source) => {
      sql(submit());
      legacy();
      const original = json("select to_jsonb(r) from public.intake_requests r");
      // Closed work keeps its assignee after departure, so erasure finds it.
      if (source === "assignee")
        sql(`update public.intake_requests set assignee_id=${q(5)},state='resolved'`);
      if (source === "message")
        sql(`insert into public.intake_messages(org_id,request_id,author_id,kind,body)
        values(${q(10)},${q(20)},${q(5)},'note','Retained text')`);
      if (source.startsWith("event"))
        sql(`insert into public.intake_events(org_id,request_id,${source === "event_actor" ? "actor_id" : "assignee_id"},kind)
        values(${q(10)},${q(20)},${q(5)},'assign')`);
      const erased = source === "requester" ? 2 : 5;
      sql(`select public.remove_org_member(${q(10)},${q(erased)},${q(1)})`);
      const manifest = JSON.stringify([
        { id: original.id, incarnation_id: original.incarnation_id, export_revision: 1 },
      ]);
      sql(`delete from auth.users where id=${q(erased)}`);
      const current = json("select to_jsonb(r) from public.intake_requests r");
      expect(current.incarnation_id).toBe(original.incarnation_id);
      expect(current.export_revision).toBe(2);
      expect(current.version).toBe(2);
      expect(current.description).toBe(original.description);
      expect(
        sql(`select public.intake_validate_export(${q(2)},'${manifest}'::jsonb)`),
      ).toBe("f");
      if (erased !== 2) {
        const refreshed = JSON.stringify([
          { id: current.id, incarnation_id: current.incarnation_id, export_revision: 2 },
        ]);
        expect(
          sql(`select public.intake_validate_export(${q(2)},'${refreshed}'::jsonb)`),
        ).toBe("t");
        expect(
          JSON.stringify(
            json(
              `select public.intake_read_history(${q(10)},${q(2)},${q(20)},${source.startsWith("event")})`,
            ),
          ),
        ).not.toContain("person5@example.test");
      }
      // A retry after attribution is gone cannot invalidate the fresh artifact.
      sql(`select public.intake_erase_identity(${q(erased)})`);
      expect(sql("select export_revision from public.intake_requests")).toBe("2");
    },
  );
  it("rolls back attribution and export invalidation when Auth deletion aborts", () => {
    sql(submit());
    sql(`create function public.test_refuse_auth_delete() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic deletion failure'; end $$;
      create trigger z_test_refuse_auth_delete before delete on auth.users
      for each row execute function public.test_refuse_auth_delete();`);
    try {
      expect(() => sql(`delete from auth.users where id=${q(2)}`)).toThrow(
        /Synthetic deletion failure/,
      );
      expect(
        json(
          "select jsonb_build_object('created_by',created_by,'export_revision',export_revision,'version',version) from public.intake_requests",
        ),
      ).toEqual({ created_by: uid(2), export_revision: 1, version: 1 });
      expect(
        sql(`select count(*) from public.intake_commands where actor_id=${q(2)}`),
      ).toBe("1");
      expect(sql(`select count(*) from auth.users where id=${q(2)}`)).toBe("1");
    } finally {
      sql(
        "drop trigger z_test_refuse_auth_delete on auth.users; drop function public.test_refuse_auth_delete()",
      );
    }
  });
  it("purges an unconfigured organization without creating a settings row", () => {
    sql(`select public.intake_purge(${q(11)},${q(6)})`);
    expect(
      sql(`select count(*) from public.intake_settings where org_id=${q(11)}`),
    ).toBe("0");
  });
  it("refuses old submissions after purge but permits fresh commands without retaining content", () => {
    sql(submit());
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    const tombstones = json(
      "select json_agg(t order by command_id) from public.intake_purged_commands t",
    );
    expect(tombstones).toEqual([
      { org_id: uid(10), actor_id: uid(2), command_id: uid(100) },
      { org_id: uid(10), actor_id: uid(3), command_id: uid(101) },
    ]);
    expect(
      sql("select count(*) from public.intake_commands where request_id is not null"),
    ).toBe("0");
    expect(sql("select count(*) from public.intake_messages")).toBe("0");
    expect(
      sql("select count(*) from public.intake_events where request_id is not null"),
    ).toBe("0");
    expect(() => sql(submit())).toThrow(/purged request data/);
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
    sql(`select public.remove_org_member(${q(10)},${q(2)},${q(1)});`);
    expect(() => sql(submit())).toThrow(/Intake not found/);
    sql(
      `insert into public.org_members(org_id,user_id) values(${q(10)},${q(2)});`,
    );
    expect(() => sql(submit())).toThrow(/purged request data/);
    expect(json(submit(150)).replayed).toBe(false);
    // Another actor's use of the same UUID does not inherit this tombstone.
    expect(
      json(submit(100, { actor: 4, request: 21, subject: "Fresh" })).replayed,
    ).toBe(false);
  });
  it("erases tombstones with account identity and organization lifecycle", () => {
    sql(submit());
    sql(cmd("assign", 3, 101, 1, `,${q(3)}`));
    sql(cmd("wait", 3, 102, 2, ",'Question?'"));
    sql(cmd("resume", 2, 103, 3, ",'Reply'"));
    sql(cmd("assign", 4, 104, 4, `,${q(4)}`));
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(sql("select count(*) from public.intake_purged_commands")).toBe("5");
    sql(`select public.intake_erase_identity(${q(2)})`);
    expect(
      sql(`select count(*) from public.intake_purged_commands where actor_id=${q(2)}`),
    ).toBe("0");
    sql(`delete from auth.users where id=${q(3)}`);
    expect(
      sql(`select count(*) from public.intake_purged_commands where actor_id=${q(3)}`),
    ).toBe("0");
    expect(sql("select count(*) from public.intake_purged_commands")).toBe("1");
    sql(`delete from public.organizations where id=${q(10)}`);
    expect(sql("select count(*) from public.intake_purged_commands")).toBe("0");
  });
  it("purges request data atomically and keeps the organization's intake anchor", () => {
    sql(submit());
    expect(() => sql(`select public.intake_purge(${q(10)},${q(5)})`)).toThrow();
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
    expect(
      sql(`select count(*) from public.intake_settings where org_id=${q(10)}`),
    ).toBe("1");
    expect(
      sql("select count(*) from public.intake_commands where request_id is not null"),
    ).toBe("0");
  });
  // An uploaded contract, as the upload worker leaves it before linking.
  const upload = (document: number, uploader = 2, org = 10, kind = "intake_attachment") =>
    sql(`insert into public.documents(id,org_id,user_id,library_kind,status)
        values(${q(document)},${q(org)},${q(uploader)},'${kind}','ready');
      insert into public.document_versions(id,document_id,storage_path,pdf_storage_path,version_number,filename,file_type,size_bytes)
        values(${q(document + 1000)},${q(document)},'documents/${uid(uploader)}/${uid(document)}/nda.docx',
          'documents/${uid(uploader)}/${uid(document)}/nda.pdf',1,'Supplier NDA.docx','docx',1234);
      update public.documents set current_version_id=${q(document + 1000)} where id=${q(document)};`);
  const attach = (document: number, actor = 2, request = 20) =>
    `select public.intake_attach_document(${q(10)},${q(actor)},${q(request)},${q(document)});`;
  const readable = (document: number, user: number, org = 10) =>
    sql(`select public.org_private_document_access(${q(org)},${q(document)},'${uid(user)}')`);
  it("attaches an uploaded document once and lists it for every member", () => {
    sql(submit());
    upload(50);
    sql(attach(50));
    sql(attach(50));
    expect(
      json(`select public.intake_list_documents(${q(10)},${q(4)},${q(20)});`),
    ).toEqual([
      expect.objectContaining({
        document_id: uid(50),
        filename: "Supplier NDA.docx",
        file_type: "docx",
        size_bytes: 1234,
        status: "ready",
        added_by_name: "person2@example.test",
      }),
    ]);
    expect(
      sql("select count(*) from public.intake_events where kind='document_added'"),
    ).toBe("1");
    expect(state()).toBe("submitted:1:-");
    for (const member of [1, 2, 3, 4, 5]) expect(readable(50, member)).toBe("t");
    expect(readable(50, 6)).toBe("f");
    expect(
      sql(`select public.document_text_access(${q(50)},'${uid(3)}',null)`),
    ).toBe("t");
    expect(() =>
      sql(`select public.intake_list_documents(${q(10)},${q(6)},${q(20)});`),
    ).toThrow(/P0002/);
  });
  it("links only the uploader's own intake documents in the same organization", () => {
    sql(submit());
    sql(submit(101, { request: 21, subject: "Second" }));
    upload(50);
    upload(51, 2, 10, "file");
    sql(`insert into public.intake_settings(org_id) values(${q(11)})`);
    upload(52, 6, 11);
    upload(53, 3);
    expect(() => sql(attach(51))).toThrow(/P0002/);
    expect(() => sql(attach(52))).toThrow(/P0002/);
    expect(() => sql(attach(53))).toThrow(/P0002/);
    expect(() => sql(attach(50, 6))).toThrow(/P0002/);
    expect(() => sql(attach(50, 2, 22))).toThrow(/P0002/);
    sql(attach(50));
    expect(() => sql(attach(50, 2, 21))).toThrow(/22023/);
    // A plain organization file is still private to its uploader.
    expect(readable(51, 3)).toBe("f");
  });
  it("keeps attachments with the request when their uploader leaves", () => {
    sql(submit());
    upload(50);
    sql(attach(50));
    expect(
      sql(`select count(*) from public.org_members_departure_items(${q(10)},array[${q(2)}]::uuid[])`),
    ).toBe("0");
    expect(
      sql(`select count(*) from public.org_private_content_items(${q(10)}) where item_id=${q(50)}`),
    ).toBe("0");
    sql(`select public.remove_org_member(${q(10)},${q(2)},${q(1)});`);
    expect(sql(`select archived_at is null from public.documents where id=${q(50)}`)).toBe("t");
    expect(readable(50, 3)).toBe("t");
    expect(readable(50, 2)).toBe("f");
    sql(`delete from auth.users where id=${q(2)}`);
    expect(
      json(`select public.intake_list_documents(${q(10)},${q(3)},${q(20)});`)[0],
    ).toMatchObject({ document_id: uid(50), added_by_name: "Former member" });
  });
  it("deletes attachments and queues their storage cleanup when request data is purged", () => {
    sql(submit());
    upload(50);
    sql(attach(50));
    sql("truncate public.db_jobs");
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(sql(`select count(*) from public.documents where id=${q(50)}`)).toBe("0");
    expect(sql("select count(*) from public.intake_request_documents")).toBe("0");
    expect(
      sql("select string_agg(k,',' order by k) from public.db_jobs j, jsonb_array_elements_text(j.payload->'keys') k where j.kind='document.cleanup'"),
    ).toBe(
      `documents/${uid(2)}/${uid(50)}/nda.docx,documents/${uid(2)}/${uid(50)}/nda.pdf,extracted-text/${uid(1050)}.txt`,
    );
  });
  it("removes attachments with a permanently purged organization", () => {
    sql(submit());
    upload(50);
    sql(attach(50));
    sql(`update public.organizations set deleted_at=now()-interval '31 days',purge_after=now()-interval '1 day' where id=${q(10)}`);
    expect(sql("select public.purge_expired_organizations(10)")).toBe("1");
    expect(sql(`select count(*) from public.documents where id=${q(50)}`)).toBe("0");
    expect(sql("select count(*) from public.intake_request_documents")).toBe("0");
  });
  it("denies browser roles the attachment table and functions", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(() =>
        sql(`set role ${role}; select * from public.intake_request_documents;`),
      ).toThrow();
      expect(() => sql(`set role ${role}; ${attach(50)}`)).toThrow();
    }
  });
  it("backfills legacy requests from their creator's profile", () => {
    // Shape of a request recorded before the tracker migration.
    sql(`alter table public.intake_requests drop constraint intake_requests_requester_check;
      alter table public.intake_requests alter column requester_name drop not null;
      insert into public.intake_settings(org_id) values(${q(10)});
      insert into public.intake_requests(id,org_id,requester_id,category,subject,description)
        values(${q(40)},${q(10)},${q(2)},'general','Legacy','Old request'),(${q(41)},${q(10)},null,'general','Erased','Old request');`);
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    const profile = sql(
      `select coalesce(nullif(btrim(display_name),''),email) from public.user_profiles where user_id=${q(2)}`,
    );
    expect(
      json(
        `select jsonb_agg(jsonb_build_object('created_by',created_by,'name',requester_name,'email',requester_email) order by id) from public.intake_requests`,
      ),
    ).toEqual([
      { created_by: uid(2), name: profile, email: "person2@example.test" },
      { created_by: null, name: "Former member", email: null },
    ]);
  });
});
