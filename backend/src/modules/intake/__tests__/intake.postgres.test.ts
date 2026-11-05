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
    assignee = "null",
  } = {},
) =>
  `select public.intake_submit_request(${q(10)},${q(actor)},${q(command)},${q(request)},'${subject}','Please review',` +
  `'${requester}','jane@acme.test',${team},${date},${assignee});`;
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
    // The current command boundary takes more arguments than the ones the
    // migrations replayed below create, and their wrappers would match both.
    // The resolution reply's migration replaces the older ones again at the end.
    sql("drop function public.intake_change_request(uuid,uuid,uuid,uuid,integer,text,text,uuid,boolean,uuid[],text)");
    // The tracker migrations are safe to re-run. Those before the type and
    // the timezone were removed expect their columns, so they come back for
    // them and go again.
    sql("alter table public.intake_requests add column category text not null default 'general'");
    sql("alter table public.intake_requests add column timezone text");
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    sql(migration("20261030_03_intake_attachments.sql"));
    sql(migration("20261030_03_intake_attachments.sql"));
    sql(migration("20261030_04_intake_delete_request.sql"));
    sql(migration("20261030_04_intake_delete_request.sql"));
    sql(migration("20261030_05_intake_sort_updated_asc.sql"));
    sql(migration("20261031_01_intake_remove_category.sql"));
    sql(migration("20261031_01_intake_remove_category.sql"));
    sql(migration("20261101_01_intake_note_documents.sql"));
    sql(migration("20261101_01_intake_note_documents.sql"));
    sql(migration("20261101_02_intake_personal_workspace.sql"));
    sql(migration("20261101_02_intake_personal_workspace.sql"));
    sql(migration("20261101_03_intake_dashboard.sql"));
    sql(migration("20261101_03_intake_dashboard.sql"));
    sql(migration("20261101_04_intake_list_scopes.sql"));
    sql(migration("20261101_04_intake_list_scopes.sql"));
    sql(migration("20261101_05_intake_requester_filter.sql"));
    sql(migration("20261101_05_intake_requester_filter.sql"));
    sql(migration("20261101_06_intake_member_photos.sql"));
    sql(migration("20261101_06_intake_member_photos.sql"));
    sql(migration("20261101_07_intake_resolution_documents.sql"));
    sql(migration("20261101_07_intake_resolution_documents.sql"));
    sql(migration("20261101_08_intake_dashboard_periods.sql"));
    sql(migration("20261101_08_intake_dashboard_periods.sql"));
    sql(migration("20261102_01_intake_resolve_optional_text.sql"));
    sql(migration("20261102_01_intake_resolve_optional_text.sql"));
    sql(migration("20261102_02_intake_automation.sql"));
    sql(migration("20261102_02_intake_automation.sql"));
    sql(migration("20261102_03_intake_assignment_rules.sql"));
    sql(migration("20261102_03_intake_assignment_rules.sql"));
    sql(migration("20261102_04_intake_remove_timezone.sql"));
    sql(migration("20261102_04_intake_remove_timezone.sql"));
    sql(migration("20261102_05_intake_rule_preprocessing.sql"));
    sql(migration("20261102_05_intake_rule_preprocessing.sql"));
    sql(migration("20261103_04_intake_replace_rules.sql"));
    sql(migration("20261103_04_intake_replace_rules.sql"));
    sql(migration("20261103_05_intake_requester_loop.sql"));
    sql(migration("20261103_05_intake_requester_loop.sql"));
    sql(migration("20261103_06_intake_mailbox.sql"));
    sql(migration("20261103_06_intake_mailbox.sql"));
    sql(migration("20261103_07_intake_teams.sql"));
    sql(migration("20261103_07_intake_teams.sql"));
    sql(migration("20261104_02_intake_resolution_reply.sql"));
    sql(migration("20261104_02_intake_resolution_reply.sql"));
    sql(migration("20261104_03_intake_preprocessing_notes.sql"));
    sql(migration("20261104_03_intake_preprocessing_notes.sql"));
    sql(migration("20261104_04_intake_assistant.sql"));
    sql(migration("20261104_04_intake_assistant.sql"));
    sql(migration("20261104_05_intake_unread_reply_count.sql"));
    sql(migration("20261104_05_intake_unread_reply_count.sql"));
    sql(migration("20261104_06_intake_always_clarify.sql"));
    sql(migration("20261104_06_intake_always_clarify.sql"));
    sql(migration("20261104_07_intake_delivery_message.sql"));
    sql(migration("20261104_07_intake_delivery_message.sql"));
    sql(migration("20261104_08_intake_notifications.sql"));
    sql(migration("20261104_08_intake_notifications.sql"));
    sql(migration("20261104_09_intake_edit_preserves_unread.sql"));
    sql(migration("20261104_09_intake_edit_preserves_unread.sql"));
  }, 90000);
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
    // Each member's photo comes once, with the member list.
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    sql(`update public.user_profiles set profile_photo='${photo}' where user_id=${q(3)}`);
    expect(
      json(`select public.intake_members(${q(10)},${q(2)});`).find(
        (m: { user_id: string }) => m.user_id === uid(3),
      ),
    ).toMatchObject({ profile_photo: photo });
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
    // Notes name their author by ID, so the page can show their photo.
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(20)});`)[0],
    ).toMatchObject({ author_id: uid(3), author_name: "person3@example.test" });
    expect(() => sql(note(4, 105, "   "))).toThrow(/22023/);
    // A request resolves without a resolution, and then has no message for
    // it; a cancellation still needs its reason.
    sql(submit(110, { request: 21 }));
    expect(json(cmd("resolve", 3, 111, 1, ",null", 21)).message_id).toBeNull();
    expect(state(21)).toBe("resolved:2:-");
    expect(
      sql(`select count(*) from public.intake_messages where request_id=${q(21)}`),
    ).toBe("0");
    sql(submit(112, { request: 22 }));
    expect(() => sql(cmd("cancel", 3, 113, 1, ",null", 22))).toThrow(/22023/);
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
    // History names who acted by ID, so the page can show their photo.
    expect(events[0]).toMatchObject({ kind: "submitted", actor_id: uid(2) });
    expect(events.at(-1)).toMatchObject({
      kind: "assignee_left",
      actor_id: null,
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
        `select public.intake_submit_request(${q(11)},${q(6)},${q(130)},${q(31)},'Question','Please help','Sam');`,
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
    const edit = (command: number, version: number, email = "'sam@acme.test'", date = "'2026-12-01'") =>
      `select public.intake_edit_request(${q(10)},${q(3)},${q(command)},${q(20)},${version},'Renamed','Updated text','Sam Business',${email},null,${date});`;
    expect(json(edit(101, 1)).applied_version).toBe(2);
    expect(
      json(`select public.intake_get_request(${q(10)},${q(4)},${q(20)});`),
    ).toMatchObject({
      created_by: uid(2),
      subject: "Renamed",
      requester_name: "Sam Business",
      requester_email: "sam@acme.test",
      requester_team: null,
      requested_by_date: "2026-12-01",
    });
    expect(
      json(`select public.intake_get_request(${q(10)},${q(4)},${q(20)});`),
    ).not.toHaveProperty("timezone");
    expect(sql("select kind from public.intake_events order by id desc limit 1")).toBe("edited");
    expect(() => sql(edit(102, 2, "'not an email'"))).toThrow(/22023/);
    // A date alone is enough, and clearing it is fine.
    expect(json(edit(103, 2, "null", "null")).applied_version).toBe(3);
    sql(cmd("resolve", 3, 105, 3, ",'Done'"));
    expect(() => sql(edit(106, 4))).toThrow(/P0001/);
  });
  it("judges overdue where the viewer is", () => {
    // Yesterday at UTC+14 is never past at UTC-11, 25 hours behind.
    sql(submit(100, {
      date: "((now() at time zone 'Pacific/Kiritimati')::date - 1)",
    }));
    const overdue = (zone: string) =>
      json(`select public.intake_list_requests(${q(10)},${q(2)},p_scope=>'overdue',p_timezone=>'${zone}');`)
        .requests.length;
    expect(overdue("Pacific/Kiritimati")).toBe(1);
    expect(overdue("Pacific/Pago_Pago")).toBe(0);
    const dashboard = (zone: string) =>
      json(`select public.intake_dashboard(${q(10)},${q(2)},'${zone}');`).overdue;
    expect(dashboard("Pacific/Kiritimati")).toBe(1);
    expect(dashboard("Pacific/Pago_Pago")).toBe(0);
    expect(() => overdue("Not/AZone")).toThrow(/22023/);
  });
  it("filters, searches and pages the queue without repeating rows", () => {
    sql(submit(100, { request: 20, subject: "First", date: "'2026-12-10'" }));
    sql(submit(101, { request: 21, subject: "Second", team: "'Marketing'", assignee: q(3) }));
    sql(submit(102, { request: 22, subject: "Third", date: "'2026-11-05'", assignee: q(4) }));
    const ids = (page: { requests: { id: string }[] }) =>
      page.requests.map((r) => r.id);
    expect(ids(list(2))).toEqual([22, 21, 20].map(uid));
    expect(ids(list(2, ",null,'unassigned'"))).toEqual([uid(20)]);
    expect(ids(list(3, ",null,'me'"))).toEqual([uid(21)]);
    expect(ids(list(2, `,null,'${uid(4)}'`))).toEqual([uid(22)]);
    expect(ids(list(2, ",'in_review'"))).toEqual([22, 21].map(uid));
    expect(ids(list(2, ",null,null,'marketing'"))).toEqual([uid(21)]);
    // One requester, by name without case; the picker lists each name once.
    sql(`update public.intake_requests set requester_name='Sam Business' where id=${q(21)}`);
    expect(ids(list(2, ",p_requester=>'sam business'"))).toEqual([uid(21)]);
    expect(ids(list(2, ",p_requester=>'JANE BUSINESS'"))).toEqual([22, 20].map(uid));
    expect(() => list(2, ",p_requester=>''")).toThrow(/22023/);
    expect(
      json(`select public.intake_list_requesters(${q(10)},${q(2)});`),
    ).toEqual([
      { name: "Jane Business", email: "jane@acme.test" },
      { name: "Sam Business", email: "jane@acme.test" },
    ]);
    expect(() =>
      sql(`select public.intake_list_requesters(${q(10)},${q(9)});`),
    ).toThrow(/P0002/);
    expect(ids(list(2, ",null,null,'jane@acme'"))).toHaveLength(3);
    expect(ids(list(2, ",null,null,'','target'"))).toEqual([22, 20, 21].map(uid));
    expect(list(2).requests[0]).not.toHaveProperty("description");
    // Updated order: page one, then a new request arrives before page two.
    const first = list(2, ",null,null,'','updated',null,null,p_limit=>2");
    expect(ids(first)).toEqual([22, 21].map(uid));
    sql(submit(103, { request: 23, subject: "Fourth" }));
    const second = list(
      2,
      `,null,null,'','updated','${first.next.key}','${first.next.id}',p_limit=>2`,
    );
    expect(ids(second)).toEqual([uid(20)]);
    expect(second.next).toBeNull();
    // Target order keeps undated requests last across pages.
    const t1 = list(2, ",null,null,'','target',null,null,p_limit=>2");
    expect(ids(t1)).toEqual([22, 20].map(uid));
    const t2 = list(2, `,null,null,'','target','${t1.next.key}','${t1.next.id}',p_limit=>2`);
    expect(t2.requests.map((r: { requested_by_date: string | null }) => r.requested_by_date)).toEqual([null, null]);
    const t3 = t2.next
      ? list(2, `,null,null,'','target',null,'${t2.next.id}',p_limit=>2`)
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
  it("links a document added with a note to the uploader's own note, without a separate event", () => {
    sql(submit());
    sql(submit(101, { request: 21, subject: "Second" }));
    const mine = json(note(2, 102, "Signed copy attached")).message_id;
    const theirs = json(note(3, 103, "Called Jane")).message_id;
    const elsewhere = json(note(2, 104, "Other request", 21)).message_id;
    upload(50);
    const withNote = (message: string) =>
      `select public.intake_attach_document(${q(10)},${q(2)},${q(20)},${q(50)},'${message}');`;
    expect(() => sql(withNote(theirs))).toThrow(/P0002/);
    expect(() => sql(withNote(elsewhere))).toThrow(/P0002/);
    sql(withNote(mine));
    sql(withNote(mine));
    expect(
      json(`select public.intake_list_documents(${q(10)},${q(4)},${q(20)});`),
    ).toEqual([expect.objectContaining({ document_id: uid(50), message_id: mine })]);
    // The note records the document; the timeline gets no second entry.
    expect(
      sql("select count(*) from public.intake_events where kind='document_added'"),
    ).toBe("0");
  });
  it("links documents added with a resolution to it, but not to a cancellation reason", () => {
    sql(submit());
    sql(submit(101, { request: 21, subject: "Second" }));
    const resolution = json(
      cmd("resolve", 2, 102, 1, ",'Approved with the signed copy.'"),
    ).message_id;
    const reason = json(cmd("cancel", 2, 103, 1, ",'Withdrawn.'", 21)).message_id;
    upload(50);
    upload(51);
    const attach = (document: number, request: number, message: string) =>
      `select public.intake_attach_document(${q(10)},${q(2)},${q(request)},${q(document)},'${message}');`;
    sql(attach(50, 20, resolution));
    expect(
      json(`select public.intake_list_documents(${q(10)},${q(4)},${q(20)});`),
    ).toEqual([
      expect.objectContaining({ document_id: uid(50), message_id: resolution }),
    ]);
    expect(() => sql(attach(51, 21, reason))).toThrow(/P0002/);
    expect(
      sql("select count(*) from public.intake_events where kind='document_added'"),
    ).toBe("0");
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
  const remove = (actor: number, command: number, version: number, request = 20) =>
    `select public.intake_delete_request(${q(10)},${q(actor)},${q(command)},${q(request)},${version});`;
  it("lets any member delete a request with its history and attachments, once", () => {
    sql(submit());
    sql(note(3, 101, "Called Jane"));
    upload(50);
    sql(attach(50));
    expect(
      json(`select public.intake_get_request(${q(10)},${q(4)},${q(20)})`)
        .capabilities.delete,
    ).toBe(true);
    expect(list(4).requests[0].capabilities.delete).toBe(true);
    sql("truncate public.db_jobs");
    // Neither the creator nor the assignee: any member may delete.
    expect(json(remove(4, 102, 1))).toEqual({
      request_id: uid(20),
      applied_version: 2,
      message_id: null,
      replayed: false,
    });
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
    expect(sql("select count(*) from public.intake_messages")).toBe("0");
    expect(
      sql("select count(*) from public.intake_events where request_id is not null"),
    ).toBe("0");
    expect(sql("select count(*) from public.intake_request_documents")).toBe("0");
    expect(sql(`select count(*) from public.documents where id=${q(50)}`)).toBe("0");
    expect(
      sql("select count(*) from public.db_jobs where kind='document.cleanup'"),
    ).toBe("1");
    // The organization keeps who deleted a request, without its content.
    expect(
      json(
        "select json_agg(json_build_object('kind',kind,'actor',actor_id,'request',request_id)) from public.intake_events",
      ),
    ).toEqual([{ kind: "request_deleted", actor: uid(4), request: null }]);
    // A retried delete gets its receipt; a lost submit cannot recreate it.
    expect(json(remove(4, 102, 1)).replayed).toBe(true);
    expect(() => sql(submit())).toThrow(/purged request data/);
    // Commands on the deleted request find nothing to act on.
    expect(() => sql(note(3, 101, "Called Jane"))).toThrow(/P0002/);
    expect(() => sql(note(3, 103, "Late note"))).toThrow(/P0002/);
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
  });
  it("deletes closed requests but refuses stale versions and outsiders", () => {
    sql(submit());
    expect(() => sql(remove(3, 101, 2))).toThrow(/P0001/);
    expect(() => sql(remove(6, 102, 1))).toThrow(/Intake not found/);
    expect(() => sql(remove(3, 103, 1, 21))).toThrow(/P0002/);
    sql(cmd("resolve", 3, 104, 1, ",'Approved'"));
    expect(json(remove(5, 105, 2)).replayed).toBe(false);
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
  });
  it("keeps a person's own requests in their personal organization, for them alone", () => {
    // Every account gets a personal organization, with itself as its owner.
    const personal = sql(
      `select id from public.organizations where personal_user_id=${q(2)} and kind='personal'`,
    );
    const own = (actor: number, command: number) =>
      `select public.intake_submit_request('${personal}',${q(actor)},${q(command)},${q(30)},'Lease renewal','Check the break clause',` +
      `'Me',null,null,null,${q(actor)});`;
    expect(json(own(2, 200)).applied_version).toBe(1);
    expect(
      json(`select public.intake_list_requests('${personal}',${q(2)});`).requests,
    ).toEqual([
      expect.objectContaining({ subject: "Lease renewal", state: "in_review" }),
    ]);
    expect(json(`select public.intake_members('${personal}',${q(2)});`)).toEqual([
      expect.objectContaining({ user_id: uid(2) }),
    ]);
    // Nobody else reaches it, not even a colleague from a shared organization.
    expect(() => sql(own(3, 201))).toThrow(/P0002/);
    expect(() =>
      sql(`select public.intake_get_request('${personal}',${q(3)},${q(30)});`),
    ).toThrow(/P0002/);
    expect(
      json(`select public.intake_list_requests(${q(10)},${q(2)});`).requests,
    ).toEqual([]);
  });
  it("summarizes where requests stand for the dashboard", () => {
    sql(submit(100, { date: "'2020-01-01'" }));
    sql(submit(101, { request: 21, subject: "Second", assignee: `${q(3)}` }));
    sql(submit(102, { request: 22, subject: "Third", assignee: `${q(3)}` }));
    sql(cmd("wait", 3, 103, 1, ",'Asked Jane'", 22));
    sql(submit(104, { request: 23, subject: "Fourth", assignee: `${q(4)}` }));
    sql(cmd("resolve", 4, 105, 1, ",'Done.'", 23));
    // Recorded two days before it was resolved.
    sql(`update public.intake_requests set created_at=now()-interval '2 days' where id=${q(23)}`);
    const dashboard = json(
      `select public.intake_dashboard(${q(10)},${q(5)},'Europe/Stockholm');`,
    );
    expect(dashboard).toMatchObject({
      open: 3,
      new: 1,
      in_progress: 1,
      waiting: 1,
      unassigned: 1,
      overdue: 1,
      created: 4,
      resolved: 1,
      created_days: 30,
      resolved_days: 30,
      median_days: 30,
      weeks_shown: 8,
      median_hours_to_resolve: 48,
    });
    expect(dashboard.weeks).toHaveLength(8);
    expect(dashboard.weeks.at(-1)).toMatchObject({ resolved: 1 });
    expect(
      dashboard.weeks.reduce((n: number, w: { created: number }) => n + w.created, 0),
    ).toBe(4);
    expect(dashboard.workload).toEqual([
      { assignee_id: uid(3), name: "person3@example.test", photo: null, open: 2, waiting: 1, overdue: 0 },
    ]);
    // Each figure opens exactly the requests it counted.
    const scoped = (scope: string, extra = "") =>
      json(
        `select public.intake_list_requests(${q(10)},${q(5)}${extra},p_scope=>'${scope}');`,
      ).requests.map((r: { subject: string }) => r.subject).sort();
    expect(scoped("open")).toEqual(["Second", "Supplier NDA", "Third"]);
    expect(scoped("unassigned")).toEqual(["Supplier NDA"]);
    expect(scoped("overdue")).toEqual(["Supplier NDA"]);
    expect(scoped("recorded_30d")).toHaveLength(4);
    expect(scoped("resolved_30d")).toEqual(["Fourth"]);
    expect(() => scoped("late")).toThrow(/22023/);
    expect(() =>
      sql(`select public.intake_dashboard(${q(10)},${q(6)},'UTC');`),
    ).toThrow(/P0002/);
    expect(() =>
      sql(`select public.intake_dashboard(${q(10)},${q(5)},'Not/AZone');`),
    ).toThrow(/22023/);
    // Each period figure reads over its own period, from a fixed set.
    expect(
      json(
        `select public.intake_dashboard(${q(10)},${q(5)},'UTC',4,7,365,30);`,
      ),
    ).toMatchObject({
      created_days: 7,
      resolved_days: 365,
      median_days: 30,
      weeks_shown: 4,
    });
    expect(() =>
      sql(`select public.intake_dashboard(${q(10)},${q(5)},'UTC',8,14);`),
    ).toThrow(/22023/);
  });
  // Replaying older migrations recreates the command boundary they knew;
  // the requester loop's migrations then bring this database back up to date.
  const beforeReplay = () =>
    sql("drop function if exists public.intake_change_request(uuid,uuid,uuid,uuid,integer,text,text,uuid,boolean,uuid[],text)");
  const afterReplay = () => {
    sql(migration("20261103_05_intake_requester_loop.sql"));
    sql(migration("20261103_06_intake_mailbox.sql"));
    sql(migration("20261103_07_intake_teams.sql"));
    sql(migration("20261104_02_intake_resolution_reply.sql"));
    sql(migration("20261104_03_intake_preprocessing_notes.sql"));
    sql(migration("20261104_04_intake_assistant.sql"));
    sql(migration("20261104_05_intake_unread_reply_count.sql"));
    sql(migration("20261104_06_intake_always_clarify.sql"));
    sql(migration("20261104_07_intake_delivery_message.sql"));
    sql(migration("20261104_08_intake_notifications.sql"));
    sql(migration("20261104_09_intake_edit_preserves_unread.sql"));
  };
  it("backfills legacy requests from their creator's profile", () => {
    beforeReplay();
    // Shape of a request recorded before the tracker migration.
    sql(`alter table public.intake_requests add column category text not null default 'general';
      alter table public.intake_requests add column timezone text;
      alter table public.intake_requests drop constraint intake_requests_requester_check;
      alter table public.intake_requests alter column requester_name drop not null;
      insert into public.intake_settings(org_id) values(${q(10)});
      insert into public.intake_requests(id,org_id,requester_id,category,subject,description)
        values(${q(40)},${q(10)},${q(2)},'general','Legacy','Old request'),(${q(41)},${q(10)},null,'general','Erased','Old request');`);
    sql(migration("20261030_02_intake_internal_tracker.sql"));
    sql(migration("20261031_01_intake_remove_category.sql"));
    sql(migration("20261101_04_intake_list_scopes.sql"));
    sql(migration("20261101_05_intake_requester_filter.sql"));
    sql(migration("20261101_06_intake_member_photos.sql"));
    sql(migration("20261102_02_intake_automation.sql"));
    sql(migration("20261102_04_intake_remove_timezone.sql"));
    sql(migration("20261102_05_intake_rule_preprocessing.sql"));
    afterReplay();
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
  // A message received for intake, before MikeGC records it.
  const inbound = (id = 70, source = "email", org = 10) =>
    sql(`insert into public.intake_inbound(id,org_id,source,external_id,payload)
      values(${q(id)},${q(org)},'${source}','message-${id}','{"text":"Please review"}')`);
  const automated = (message = 70, request = 21, reviewer = "null") =>
    `select public.intake_submit_automated(${q(10)},${q(message)},${q(request)},'Supplier NDA','Summary',` +
    `'Jane Business','jane@acme.test',null,${reviewer});`;
  it("records MikeGC's request from a received message once, as no member", () => {
    inbound();
    expect(sql(automated(70, 21, q(3)))).toBe(uid(21));
    // The same message handled again returns the request it already made.
    expect(sql(automated(70, 22, q(3)))).toBe(uid(21));
    expect(sql("select count(*) from public.intake_requests")).toBe("1");
    expect(
      json(`select public.intake_get_request(${q(10)},${q(2)},${q(21)});`),
    ).toMatchObject({
      created_by: null,
      created_by_name: "MikeGC",
      source: "email",
      state: "in_review",
      assignee_id: uid(3),
    });
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},true);`),
    ).toMatchObject([
      {
        kind: "submitted",
        actor_id: null,
        actor_name: "MikeGC",
        assignee_name: "person3@example.test",
      },
    ]);
    expect(
      sql(`select request_id from public.intake_inbound where id=${q(70)}`),
    ).toBe(uid(21));
    // A member's request still names its creator and source.
    sql(submit());
    expect(
      json(`select public.intake_get_request(${q(10)},${q(2)},${q(20)});`),
    ).toMatchObject({ created_by_name: "person2@example.test", source: "manual" });
  });
  it("leaves MikeGC's request unassigned when its reviewer is not a member", () => {
    inbound();
    sql(automated(70, 21, q(6)));
    expect(state(21)).toBe("submitted:1:-");
  });
  it("refuses another organization's message and invalid details", () => {
    inbound(71, "slack", 11);
    expect(() => sql(automated(71))).toThrow(/P0002/);
    inbound(72);
    expect(() =>
      sql(
        `select public.intake_submit_automated(${q(10)},${q(72)},${q(23)},' ','Summary','Jane',null,null,null);`,
      ),
    ).toThrow(/22023/);
    expect(sql("select count(*) from public.intake_requests")).toBe("0");
  });
  it("attaches MikeGC's documents as the organization's, with no uploader", () => {
    inbound();
    sql(automated());
    sql(`insert into public.documents(id,org_id,user_id,library_kind,status)
      values(${q(60)},${q(10)},null,'intake_attachment','ready')`);
    const attachAutomated = (document: number) =>
      `select public.intake_attach_automated(${q(10)},${q(21)},${q(document)});`;
    sql(attachAutomated(60));
    sql(attachAutomated(60));
    expect(
      json(`select public.intake_list_documents(${q(10)},${q(3)},${q(21)});`),
    ).toMatchObject([{ document_id: uid(60), added_by_name: "MikeGC" }]);
    expect(readable(60, 4)).toBe("t");
    expect(readable(60, 6)).toBe("f");
    // A member's upload is linked by the member, never as MikeGC's.
    upload(61);
    expect(() => sql(attachAutomated(61))).toThrow(/P0002/);
  });
  it("deletes received messages with the organization's intake data, and their staged files", () => {
    inbound();
    sql(automated());
    inbound(73, "slack");
    // An email still waiting, with an attachment staged in storage.
    sql(`insert into public.intake_inbound(id,org_id,source,external_id,payload)
      values(${q(74)},${q(10)},'email','message-74',
        '{"kind":"email","attachments":[{"key":"intake-inbound/org/74/0"},{"key":""}]}')`);
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(sql("select count(*) from public.intake_inbound")).toBe("0");
    expect(
      sql("select payload->'keys' from public.db_jobs where kind='storage.cleanup'"),
    ).toBe('["intake-inbound/org/74/0"]');
    // An organization's purge cascades to its messages the same way.
    sql(`insert into public.intake_inbound(id,org_id,source,external_id,payload)
      values(${q(75)},${q(11)},'email','message-75',
        '{"kind":"email","attachments":[{"key":"intake-inbound/other/75/0"}]}')`);
    sql(`delete from public.organizations where id=${q(11)}`);
    expect(
      sql("select count(*) from public.db_jobs where kind='storage.cleanup' and payload->'keys' ? 'intake-inbound/other/75/0'"),
    ).toBe("1");
  });
  it("keeps automation settings and messages from browser roles", () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of [
        "intake_automation",
        "intake_assignment_rules",
        "intake_inbound",
      ])
        expect(
          sql(`select has_table_privilege('${role}','public.${table}','SELECT')`),
        ).toBe("f");
      expect(
        sql(
          `select has_function_privilege('${role}','public.intake_submit_automated(uuid,uuid,uuid,text,text,text,text,date,uuid)','EXECUTE')`,
        ),
      ).toBe("f");
      expect(
        sql(
          `select has_function_privilege('${role}','public.intake_attach_automated(uuid,uuid,uuid,uuid)','EXECUTE')`,
        ),
      ).toBe("f");
    }
  });
  it("carries each member's note of what they handle over as a rule", () => {
    // The table the rules replace, as an upgraded database still has it,
    // from when requests still had a timezone.
    beforeReplay();
    sql("alter table public.intake_requests add column timezone text");
    sql(migration("20261102_02_intake_automation.sql"));
    sql(`insert into public.intake_member_focus(org_id,user_id,focus,updated_at)
      values(${q(10)},${q(3)},'Employment','2026-11-02T10:00:00Z'),
            (${q(10)},${q(2)},'NDAs and procurement contracts','2026-11-02T09:00:00Z')`);
    sql(migration("20261102_03_intake_assignment_rules.sql"));
    sql(migration("20261102_04_intake_remove_timezone.sql"));
    sql(migration("20261102_05_intake_rule_preprocessing.sql"));
    afterReplay();
    expect(
      json(`select jsonb_agg(jsonb_build_object('position',position,'condition',condition,'assignee',assignee_id) order by position)
        from public.intake_assignment_rules where org_id=${q(10)}`),
    ).toEqual([
      { position: 0, condition: "NDAs and procurement contracts", assignee: uid(2) },
      { position: 1, condition: "Employment", assignee: uid(3) },
    ]);
    expect(sql("select to_regclass('public.intake_member_focus') is null")).toBe("t");
    sql(`delete from public.intake_assignment_rules where org_id=${q(10)}`);
  });
  it("posts MikeGC's notes once, as MikeGC", () => {
    inbound();
    sql(automated(70, 21));
    const post = (body: string) =>
      sql(`select public.intake_note_automated(${q(10)},${q(21)},${q(80)},'${body}','preprocessing');`);
    expect(post("AI preprocessing\n\nLooks fine.")).toBe("t");
    expect(post("Posted again")).toBe("f");
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)});`),
    ).toEqual([
      expect.objectContaining({
        id: uid(80),
        kind: "note",
        author_id: null,
        author_name: "MikeGC",
        automated: true,
        purpose: "preprocessing",
        body: "AI preprocessing\n\nLooks fine.",
      }),
    ]);
    // Any other note of MikeGC's is a comment, and nothing else is a purpose.
    sql(`select public.intake_note_automated(${q(10)},${q(21)},${q(83)},'A related thread');`);
    expect(
      sql(`select coalesce(purpose,'-') from public.intake_messages where id=${q(83)}`),
    ).toBe("-");
    expect(() =>
      sql(`select public.intake_note_automated(${q(10)},${q(21)},${q(84)},'Odd','summary');`),
    ).toThrow(/22023/);
    expect(() =>
      sql(`select public.intake_note_automated(${q(10)},${q(99)},${q(81)},'Lost');`),
    ).toThrow(/P0002/);
    expect(() =>
      sql(`select public.intake_note_automated(${q(10)},${q(21)},${q(82)},' ');`),
    ).toThrow(/22023/);
  });
  it("keeps a rule's preprocessing reference whole", () => {
    const add = (kind: string, ref: string) =>
      sql(`insert into public.intake_assignment_rules(org_id,position,condition,assignee_id,preprocess,preprocess_kind,preprocess_ref)
        values(${q(10)},0,'NDAs',${q(3)},true,${kind},${ref})`);
    add("'playbook'", "'pb-1'");
    add("null", "null");
    expect(() => add("'playbook'", "null")).toThrow(/23514/);
    expect(() => add("'macro'", "'m-1'")).toThrow(/23514/);
    sql(`delete from public.intake_assignment_rules where org_id=${q(10)}`);
  });
  it("replaces an organization's rules in one transaction, keeping them when the new ones are refused", () => {
    sql(`insert into public.intake_automation(org_id) values(${q(10)}) on conflict do nothing`);
    const replace = (rules: unknown[]) =>
      sql(`select public.intake_replace_rules(${q(10)}, '${JSON.stringify(rules)}'::jsonb)`);
    replace([
      { condition: "NDAs", assignee_id: uid(2), preprocess: true, preprocess_kind: "playbook", preprocess_ref: "pb-1" },
      { condition: "Employment", assignee_id: uid(3), preprocess: false, preprocess_kind: null, preprocess_ref: null },
    ]);
    const saved = () =>
      json(`select jsonb_agg(jsonb_build_object('position',position,'condition',condition,'kind',preprocess_kind) order by position)
        from public.intake_assignment_rules where org_id=${q(10)}`);
    expect(saved()).toEqual([
      { position: 0, condition: "NDAs", kind: "playbook" },
      { position: 1, condition: "Employment", kind: null },
    ]);
    // A rule the table refuses rolls back the deletion too.
    expect(() =>
      replace([{ condition: "Disputes", assignee_id: uid(2), preprocess: true, preprocess_kind: "macro", preprocess_ref: "m-1" }]),
    ).toThrow(/23514/);
    expect(saved()).toHaveLength(2);
    expect(() => sql(`select public.intake_replace_rules(${q(99)}, '[]'::jsonb)`)).toThrow(/P0002/);
    replace([]);
    expect(sql(`select count(*) from public.intake_assignment_rules where org_id=${q(10)}`)).toBe("0");
  });
  it("forgets a member's rules once they leave", () => {
    sql(`insert into public.intake_assignment_rules(org_id,position,condition,assignee_id)
      values(${q(10)},0,'The request is about an NDA',${q(3)})`);
    sql(`delete from public.org_members where org_id=${q(10)} and user_id=${q(3)}`);
    expect(sql("select count(*) from public.intake_assignment_rules")).toBe("0");
  });
  // The requester loop: a request MikeGC recorded from a Slack thread.
  const thread = (request = 21, message = 70, reviewer = "null") => {
    inbound(message, "slack");
    sql(automated(message, request, reviewer));
    return sql(
      `select public.intake_link_thread(${q(10)},${q(request)},'slack','T1:C1:${message}',` +
        `'{"channel":"C1","thread_ts":"1.${message}","channel_name":"legal-requests"}'::jsonb)`,
    );
  };
  const ask = (n: number, stage = "rule", request = 21, acknowledge = false) =>
    sql(
      `select public.intake_ask_automated(${q(10)},${q(request)},${q(n)},${q(n + 1)},` +
        `'Before Legal starts, MikeGC needs:\n1. Is Acme a customer or a supplier?','${stage}',${acknowledge})`,
    );
  const reply = (inboundId: number, message: number, request = 21, body = "Acme is a customer.") => {
    sql(`insert into public.intake_inbound(id,org_id,source,kind,external_id,payload,request_id)
      values(${q(inboundId)},${q(10)},'slack','reply','C1:${inboundId}','{}',${q(request)}) on conflict do nothing`);
    return json(
      `select public.intake_reply_automated(${q(10)},${q(inboundId)},${q(message)},'${body}',` +
        `'{"name":"Jane Business","email":"jane@acme.test","source":"slack"}'::jsonb);`,
    );
  };
  const clarify = (request = 21) =>
    sql(
      `select coalesce(clarify_stage,'-')||':'||clarify_rounds||':'||clarify_stopped from public.intake_requests where id=${q(request)}`,
    );
  const view = (request = 21) =>
    json(`select public.intake_get_request(${q(10)},${q(2)},${q(request)});`);
  const outbox = (request = 21) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'message_id',message_id,'author_id',author_id,
      'documents',documents,'status',status) order by created_at, id),'[]') from public.intake_outbound where request_id=${q(request)}`);
  const orgDocument = (document: number, request = 21) =>
    sql(`insert into public.documents(id,org_id,user_id,library_kind,status)
        values(${q(document)},${q(10)},null,'intake_attachment','ready');
      insert into public.document_versions(id,document_id,storage_path,version_number,filename,file_type,size_bytes)
        values(${q(document + 1000)},${q(document)},'documents/intake-${uid(10)}/${uid(document)}/nda.docx',1,'Supplier NDA.docx','docx',1234);
      update public.documents set current_version_id=${q(document + 1000)} where id=${q(document)};
      select public.intake_attach_automated(${q(10)},${q(request)},${q(document)});`);
  it("links a request to its thread once, and leaves a thread another request has alone", () => {
    const link = thread();
    expect(link).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      sql(`select public.intake_link_thread(${q(10)},${q(21)},'slack','T1:C1:70','{}'::jsonb)`),
    ).toBe(link);
    inbound(71, "slack");
    sql(automated(71, 22));
    expect(
      sql(`select public.intake_link_thread(${q(10)},${q(22)},'slack','T1:C1:70','{}'::jsonb)`),
    ).toBe("");
    expect(view()).toMatchObject({
      source: "slack",
      conversation: { source: "slack", channel_name: "legal-requests", documents: true },
      capabilities: { send_to_requester: true, stop_asking: false },
    });
    expect(view(22)).toMatchObject({ conversation: null, capabilities: { send_to_requester: false } });
  });
  it("asks the requester in the acknowledgement, records the answer and settles on the rule", () => {
    thread();
    expect(ask(300, "rule", 21, true)).toBe("t");
    // Asked again with the same names, nothing is added.
    expect(ask(300, "rule", 21, true)).toBe("t");
    expect(state(21)).toBe("needs_information:2:-");
    expect(clarify()).toBe("rule:1:false");
    expect(outbox()).toEqual([
      expect.objectContaining({ kind: "acknowledgement", message_id: uid(301), author_id: null, status: "pending" }),
    ]);
    expect(view()).toMatchObject({ clarify_stage: "rule", clarify_rounds: 1, clarify_max_rounds: 2, capabilities: { stop_asking: true } });
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},false);`),
    ).toEqual([
      expect.objectContaining({
        kind: "question",
        automated: true,
        author_name: "MikeGC",
        delivery: expect.objectContaining({ kind: "acknowledgement", status: "pending" }),
      }),
    ]);
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},true);`).map((e: { kind: string }) => e.kind),
    ).toEqual(["submitted", "wait"]);
    // The answer is recorded once; the stage that asked decides what next.
    expect(reply(400, 410)).toMatchObject({ clarify_stage: "rule", clarify_rounds: 1, state: "needs_information" });
    expect(reply(400, 410)).toMatchObject({ clarify_stage: "rule" });
    expect(sql(`select count(*) from public.intake_messages where kind='reply'`)).toBe("1");
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},false);`)[1],
    ).toMatchObject({ kind: "reply", author_id: null, author_name: "Jane Business", external_author: { source: "slack" } });
    expect(view()).toMatchObject({ new_reply: true });
    expect(list(2, ",p_new_reply=>true").requests.map((r: { id: string }) => r.id)).toEqual([uid(21)]);
    // A member who saw only an earlier reply leaves the latest one new.
    const last = sql(`select last_reply_at from public.intake_requests where id=${q(21)}`);
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(4)},${q(21)},'${last}'::timestamptz - interval '1 second')`);
    expect(view()).toMatchObject({ new_reply: true });
    // A time in the future counts only up to now.
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(4)},${q(21)},now() + interval '1 day')`);
    expect(
      sql(`select reply_seen_at <= now() from public.intake_requests where id=${q(21)}`),
    ).toBe("t");
    expect(view()).toMatchObject({ new_reply: false });
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(4)},${q(21)})`);
    expect(view()).toMatchObject({ new_reply: false, last_reply_at: expect.any(String) });
    expect(list(2, ",p_new_reply=>true").requests).toEqual([]);
    // Settled on the rule's member: back to work, assigned.
    expect(
      sql(`select public.intake_settle_clarify_automated(${q(10)},${q(21)},'rule',true,${q(3)})`),
    ).toBe("t");
    expect(state(21)).toBe(`in_review:3:${uid(3)}`);
    expect(clarify()).toBe("-:1:false");
    expect(
      sql(`select public.intake_settle_clarify_automated(${q(10)},${q(21)},'rule',true,${q(3)})`),
    ).toBe("f");
    // The acknowledgement goes once, with the questions.
    expect(sql(`select public.intake_acknowledge_automated(${q(10)},${q(21)},${q(320)})`)).toBe(uid(300));
  });
  it.each([
    { field: "date", stage: "rule" },
    { field: "details", stage: "readiness" },
  ])("metadata edits ($field) preserve unread replies while stopping the $stage stage", ({ field, stage }) => {
    thread(21, 70, q(3));
    ask(300, stage);
    reply(400, 410);
    const before = view();
    expect(before).toMatchObject({ new_reply: true, state: "needs_information", clarify_stage: stage });
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 1 });
    const seen = sql(`select coalesce(reply_seen_at::text,'-') from public.intake_requests where id=${q(21)}`);
    const text = (value: string | null) => value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
    const edit = `select public.intake_edit_request(${q(10)},${q(3)},${q(500)},${q(21)},${before.version},` +
      `${text(before.subject)},${text(field === "details" ? "Corrected description" : before.description)},` +
      `${text(before.requester_name)},${text(before.requester_email)},${text(before.requester_team)},'2026-12-01');`;
    expect(json(edit)).toMatchObject({ applied_version: before.version + 1, preprocess: stage === "readiness" });
    expect(view()).toMatchObject({ new_reply: true, state: "in_review", clarify_stage: null });
    expect(clarify()).toBe("-:1:true");
    expect(ask(320, stage)).toBe("f");
    expect(sql(`select coalesce(reply_seen_at::text,'-') from public.intake_requests where id=${q(21)}`)).toBe(seen);
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 1 });
    expect(list(2, ",p_new_reply=>true").requests.map((r: { id: string }) => r.id)).toEqual([uid(21)]);
    // Replaying the metadata command must neither clear unread nor stop twice.
    expect(json(edit)).toMatchObject({ replayed: true, applied_version: before.version + 1 });
    expect(sql(`select count(*) from public.intake_events where request_id=${q(21)} and kind='edited'`)).toBe("1");
    expect(sql(`select count(*) from public.intake_events where request_id=${q(21)} and kind='stop_asking'`)).toBe("1");
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 1 });
  });
  it("metadata command retries preserve a newer reply until its explicit seen watermark", () => {
    thread();
    reply(400, 410);
    const first = view();
    const edit = `select public.intake_edit_request(${q(10)},${q(3)},${q(500)},${q(21)},${first.version},` +
      `'Supplier NDA','Summary','Jane Business',null,null,'2026-12-01');`;
    json(edit);
    // A reply arrives after the Messages panel's snapshot was read.
    reply(401, 411, 21, "The deadline has changed.");
    const latest = view();
    expect(latest.last_reply_at).not.toBe(first.last_reply_at);
    expect(json(edit)).toMatchObject({ replayed: true });
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 2 });
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(3)},${q(21)},'${first.last_reply_at}')`);
    expect(view()).toMatchObject({ new_reply: true });
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 1 });
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(3)},${q(21)},'${latest.last_reply_at}')`);
    expect(view()).toMatchObject({ new_reply: false });
    expect(list(2).requests[0]).toMatchObject({ new_reply: false, unread_replies: 0 });
    // A delayed older seen request cannot move the watermark backwards.
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(3)},${q(21)},'${first.last_reply_at}')`);
    expect(json(edit)).toMatchObject({ replayed: true });
    expect(view()).toMatchObject({ new_reply: false });
    expect(sql(`select reply_seen_at=last_reply_at from public.intake_requests where id=${q(21)}`)).toBe("t");
  });
  it("unread watermark races keep a newer reply new across concurrent PostgreSQL connections", async () => {
    thread();
    reply(400, 410);
    const first = view();
    sql(`select public.intake_edit_request(${q(10)},${q(3)},${q(500)},${q(21)},1,'Supplier NDA','Summary','Jane Business',null,null,'2026-12-01');`);
    sql(`insert into public.intake_inbound(id,org_id,source,kind,external_id,payload,request_id)
      values(${q(401)},${q(10)},'slack','reply','C1:401','{}',${q(21)})`);
    const results = await Promise.all([
      parallel(`select public.intake_reply_automated(${q(10)},${q(401)},${q(411)},'Updated deadline','{}')`),
      parallel(`select public.intake_mark_reply_seen(${q(10)},${q(3)},${q(21)},'${first.last_reply_at}')`),
    ]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(list(2).requests[0]).toMatchObject({ new_reply: true, unread_replies: 1 });
    expect(sql(`select reply_seen_at<last_reply_at from public.intake_requests where id=${q(21)}`)).toBe("t");
  });
  it("unread edit boundaries still reject closed, foreign and stale edits", () => {
    thread();
    reply(400, 410);
    const edit = (actor = 3, version = 1, request = 21) =>
      `select public.intake_edit_request(${q(10)},${q(actor)},${q(500)},${q(request)},${version},'Supplier NDA','Summary','Jane Business',null,null,null);`;
    expect(() => sql(edit(6))).toThrow(/P0002/);
    expect(() => sql(edit(3, 1, 99))).toThrow(/P0002/);
    expect(() => sql(edit(3, 0))).toThrow(/P0001/);
    expect(() => sql(`select public.intake_mark_reply_seen(${q(10)},${q(6)},${q(21)})`)).toThrow(/P0002/);
    expect(view()).toMatchObject({ new_reply: true });
    const first = view();
    sql(`select public.intake_mark_reply_seen(${q(10)},${q(3)},${q(21)},'${first.last_reply_at}')`);
    expect(view()).toMatchObject({ new_reply: false });
    // Closing a request keeps the existing edit rejection; later replies do not reopen it.
    sql(cmd("resolve", 3, 501, 1, ",'Done'", 21));
    reply(401, 411);
    expect(() => sql(edit(3, 2))).toThrow(/P0001/);
    expect(() => sql(edit(3, 1))).toThrow(/P0001/);
    expect(view()).toMatchObject({ new_reply: true, state: "resolved", version: 2 });
    expect(sql(`select count(*) from public.intake_commands where command_id=${q(500)}`)).toBe("0");
  });
  it("asks at most two rounds, and never once a lawyer has acted", () => {
    thread();
    expect(ask(300)).toBe("t");
    expect(ask(302)).toBe("t");
    expect(clarify()).toBe("rule:2:false");
    expect(ask(304)).toBe("f");
    thread(22, 71, q(3));
    expect(ask(310, "readiness", 22)).toBe("t");
    // A lawyer's command stops MikeGC asking, and asks for preprocessing to run now.
    const assigned = json(cmd("assign", 2, 120, 2, `,${q(2)}`, 22));
    expect(assigned).toMatchObject({ preprocess: true, outbound_id: null });
    expect(clarify(22)).toBe("-:1:true");
    expect(ask(312, "readiness", 22)).toBe("f");
    // A reply then runs nothing: it moves the request back to work.
    expect(reply(401, 411, 22)).toMatchObject({ clarify_stage: null, clarify_stopped: true, state: "in_review" });
  });
  it("posts a lawyer's question in the thread, and the answer puts the request back to work", () => {
    thread(21, 70, q(3));
    const asked = json(
      `select public.intake_wait_request(${q(10)},${q(3)},${q(120)},${q(21)},1,'Which entity is signing?',true);`,
    );
    expect(asked.outbound_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(state(21)).toBe(`needs_information:2:${uid(3)}`);
    // A follow-up while waiting; without sending, waiting twice still conflicts.
    expect(
      json(`select public.intake_wait_request(${q(10)},${q(3)},${q(121)},${q(21)},2,'And by when?',true);`).applied_version,
    ).toBe(3);
    expect(() => sql(cmd("wait", 3, 122, 3, ",'Internal'", 21))).toThrow(/P0001/);
    expect(outbox()).toEqual([
      expect.objectContaining({ kind: "question", author_id: uid(3), status: "pending" }),
      expect.objectContaining({ kind: "question", author_id: uid(3) }),
    ]);
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},false);`)[0],
    ).toMatchObject({ kind: "question", author_name: "person3@example.test", delivery: { kind: "question" } });
    expect(reply(400, 410)).toMatchObject({ state: "in_review", clarify_stage: null });
    expect(state(21)).toBe(`in_review:4:${uid(3)}`);
    // A request with no thread has nowhere to send.
    inbound(71);
    sql(automated(71, 22));
    expect(() =>
      sql(`select public.intake_wait_request(${q(10)},${q(3)},${q(123)},${q(22)},1,'Hello?',true);`),
    ).toThrow(/22023/);
    // A question sent needs its text.
    expect(() =>
      sql(`select public.intake_wait_request(${q(10)},${q(3)},${q(124)},${q(21)},4,null,true);`),
    ).toThrow(/22023/);
  });
  it("sends the resolution with the request's chosen documents, and records a later reply without reopening", () => {
    thread(21, 70, q(3));
    orgDocument(60);
    inbound(71);
    sql(automated(71, 22));
    orgDocument(62, 22);
    // Only the request's own documents.
    expect(() =>
      sql(`select public.intake_resolve_request(${q(10)},${q(3)},${q(129)},${q(21)},1,'Approved.',true,array[${q(62)}]::uuid[]);`),
    ).toThrow(/22023/);
    const resolved = json(
      `select public.intake_resolve_request(${q(10)},${q(3)},${q(130)},${q(21)},1,'Approved with edits.',true,array[${q(60)}]::uuid[],'Here is the signed NDA.');`,
    );
    expect(resolved.outbound_id).toMatch(/^[0-9a-f-]{36}$/);
    // The reply is its own message, sent; the resolution stays in the app.
    const reply_message = sql(
      `select id from public.intake_messages where request_id=${q(21)} and kind='answer' and body='Here is the signed NDA.'`,
    );
    expect(reply_message).toMatch(/^[0-9a-f-]{36}$/);
    expect(outbox()).toEqual([
      expect.objectContaining({
        kind: "answer",
        message_id: reply_message,
        author_id: uid(3),
        documents: [{ document_id: uid(60), version_id: uid(1060) }],
      }),
    ]);
    const messages = json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)});`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "resolution", body: "Approved with edits.", delivery: null }),
        expect.objectContaining({
          kind: "answer",
          body: "Here is the signed NDA.",
          delivery: expect.objectContaining({ kind: "answer", status: "pending", message_id: reply_message }),
        }),
      ]),
    );
    // The resolve event's delivery names the reply it sent, so the page can
    // show the internal resolution and the reply side by side.
    const events = json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},true);`);
    expect(events[events.length - 1]).toMatchObject({
      kind: "resolve",
      delivery: {
        kind: "answer",
        status: "pending",
        message_id: reply_message,
        documents: [{ document_id: uid(60), filename: "Supplier NDA.docx", left_out: false }],
      },
    });
    // The replay returns the same receipt and writes nothing more.
    expect(
      json(`select public.intake_resolve_request(${q(10)},${q(3)},${q(130)},${q(21)},1,'Approved with edits.',true,array[${q(60)}]::uuid[],'Here is the signed NDA.');`),
    ).toMatchObject({ replayed: true, outbound_id: resolved.outbound_id });
    expect(outbox()).toHaveLength(1);
    expect(reply(400, 410)).toMatchObject({ state: "resolved" });
    expect(state(21)).toBe(`resolved:2:${uid(3)}`);
    expect(view()).toMatchObject({ new_reply: true, capabilities: { send_to_requester: false } });
  });
  it("lets members edit an open request's documents, and none once it closes", () => {
    thread(21, 70, q(3));
    orgDocument(60);
    const editable = (actor: number) =>
      sql(`select public.intake_document_editable(${q(10)},${q(actor)},${q(60)})`);
    // Any member, not only the reviewer; someone outside the organization never.
    expect(editable(2)).toBe("t");
    expect(editable(3)).toBe("t");
    expect(editable(6)).toBe("f");
    sql(`select public.intake_resolve_request(${q(10)},${q(3)},${q(133)},${q(21)},1,null);`);
    expect(editable(2)).toBe("f");
    // A chat started from the request names it, and outlives it.
    sql(`insert into public.chats(id,user_id,org_id,intake_request_id) values(${q(90)},${q(2)},${q(10)},${q(21)})`);
    sql(`delete from public.intake_requests where id=${q(21)}`);
    expect(sql(`select coalesce(intake_request_id::text,'-') from public.chats where id=${q(90)}`)).toBe("-");
  });
  it("names no message for documents a resolution sends alone", () => {
    thread(21, 70, q(3));
    orgDocument(60);
    json(
      `select public.intake_resolve_request(${q(10)},${q(3)},${q(130)},${q(21)},1,'Internal only.',true,array[${q(60)}]::uuid[]);`,
    );
    expect(outbox()).toEqual([expect.objectContaining({ kind: "answer", message_id: null })]);
    const events = json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},true);`);
    expect(events[events.length - 1]).toMatchObject({
      kind: "resolve",
      delivery: { kind: "answer", message_id: null, documents: [expect.objectContaining({ document_id: uid(60) })] },
    });
  });
  it("sends nothing for a resolution with no reply and no documents, even with a resolution", () => {
    thread(21, 70, q(3));
    expect(
      json(`select public.intake_resolve_request(${q(10)},${q(3)},${q(130)},${q(21)},1,null,true,'{}'::uuid[]);`),
    ).toMatchObject({ outbound_id: null, message_id: null });
    expect(outbox()).toEqual([]);
    // The internal resolution is never what goes to the requester.
    thread(22, 71, q(3));
    expect(
      json(`select public.intake_resolve_request(${q(10)},${q(3)},${q(131)},${q(22)},1,'Internal only.',true,'{}'::uuid[]);`),
    ).toMatchObject({ outbound_id: null });
    expect(outbox(22)).toEqual([]);
    // A reply goes only with sending.
    thread(23, 72, q(3));
    expect(() =>
      sql(`select public.intake_resolve_request(${q(10)},${q(3)},${q(132)},${q(23)},1,null,false,null,'Hello');`),
    ).toThrow(/22023/);
  });
  it("records how a delivery went, and lets a member send a failed one again", () => {
    thread(21, 70, q(3));
    const { outbound_id: id } = json(
      `select public.intake_wait_request(${q(10)},${q(3)},${q(120)},${q(21)},1,'Which entity?',true);`,
    );
    sql(`select public.intake_record_delivery(${q(10)},'${id}','failed',null,'MikeGC was removed from #legal-requests.')`);
    expect(
      json(`select public.intake_read_history(${q(10)},${q(2)},${q(21)},false);`)[0].delivery,
    ).toMatchObject({ status: "failed", error: "MikeGC was removed from #legal-requests." });
    expect(sql(`select public.intake_retry_delivery(${q(10)},${q(4)},${q(21)},'${id}')`)).toBe("t");
    expect(sql(`select public.intake_retry_delivery(${q(10)},${q(4)},${q(21)},'${id}')`)).toBe("f");
    expect(() => sql(`select public.intake_retry_delivery(${q(10)},${q(6)},${q(21)},'${id}')`)).toThrow(/P0002/);
    sql(`select public.intake_record_delivery(${q(10)},'${id}','sent','C1:1.2',null)`);
    expect(sql(`select status||':'||external_id||':'||(sent_at is not null) from public.intake_outbound where id='${id}'`)).toBe(
      "sent:C1:1.2:true",
    );
  });
  it("stops MikeGC asking only while it waits, putting the request back to work", () => {
    thread(21, 70, q(3));
    expect(() => sql(cmd("stop_asking", 3, 120, 1, "", 21))).toThrow(/P0001/);
    expect(ask(300, "readiness")).toBe("t");
    expect(json(cmd("stop_asking", 3, 121, 2, "", 21))).toMatchObject({ preprocess: true });
    expect(state(21)).toBe(`in_review:3:${uid(3)}`);
    expect(clarify()).toBe("-:1:true");
    // An edit stops it too.
    thread(22, 71, q(3));
    expect(ask(310, "readiness", 22)).toBe("t");
    expect(
      json(`select public.intake_edit_request(${q(10)},${q(3)},${q(122)},${q(22)},2,'Supplier NDA','Summary','Jane Business',null,null,null);`),
    ).toMatchObject({ preprocess: true });
    expect(clarify(22)).toBe("-:1:true");
    // It goes back to work as Stop asking would, and the history says so.
    expect(state(22)).toBe(`in_review:3:${uid(3)}`);
    expect(
      sql(`select string_agg(kind||':'||from_state||'>'||to_state, ',' order by created_at, kind)
        from public.intake_events where request_id=${q(22)} and kind in ('edited','stop_asking')`),
    ).toBe("edited:needs_information>needs_information,stop_asking:needs_information>in_review");
  });
  it("deletes a request's thread, outbox and Message-IDs with it", () => {
    const link = thread(21, 70, q(3));
    expect(ask(300)).toBe("t");
    sql(`insert into public.intake_email_message_ids(org_id,link_id,message_id) values(${q(10)},'${link}','abc@mail.test')`);
    sql(cmd("delete", 3, 130, 2, "", 21));
    for (const table of ["intake_channel_links", "intake_outbound", "intake_email_message_ids"])
      expect(sql(`select count(*) from public.${table}`)).toBe("0");
    // A reply arriving after has no request to land on.
    sql(`insert into public.intake_inbound(id,org_id,source,kind,external_id,payload)
      values(${q(402)},${q(10)},'slack','reply','C1:402','{}')`);
    expect(
      sql(`select public.intake_reply_automated(${q(10)},${q(402)},${q(412)},'Late','{}'::jsonb)`),
    ).toBe("");
  });
  it("keeps the requester loop from browser roles", () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["intake_channel_links", "intake_outbound", "intake_email_message_ids"])
        expect(sql(`select has_table_privilege('${role}','public.${table}','SELECT')`)).toBe("f");
      for (const fn of [
        "intake_ask_automated(uuid,uuid,uuid,uuid,text,text,boolean,jsonb)",
        "intake_reply_automated(uuid,uuid,uuid,text,jsonb)",
        "intake_record_delivery(uuid,uuid,text,text,text,jsonb)",
        "intake_mark_reply_seen(uuid,uuid,uuid,timestamptz)",
      ])
        expect(sql(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`)).toBe("f");
    }
  });
  it("leaves no intake function callable by browser roles once every migration has run", () => {
    // A migration that recreates a function starts it with default grants.
    for (const role of ["anon", "authenticated"])
      expect(
        sql(`select coalesce(string_agg(p.oid::regprocedure::text, ', '), '') from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'intake\\_%'
            and has_function_privilege('${role}', p.oid, 'EXECUTE')`),
      ).toBe("");
  });
  // Toasts for the member a request is assigned to.
  type Claimed = { change: string; kind: string; created_at: string } & Record<string, unknown>;
  const claim = (actor: number): Claimed[] =>
    json(`select public.intake_claim_notifications(${q(actor)});`);
  const waiting = () => sql("select count(*) from public.intake_notifications");
  it("tells the assignee about a request that became theirs, once, and never about their own changes", () => {
    sql(submit(100, { assignee: q(2) }));
    expect(claim(2)).toEqual([]);
    sql(cmd("assign", 2, 101, 1, `,${q(3)}`));
    expect(claim(3)).toEqual([
      {
        id: expect.any(Number),
        workspace: uid(10),
        workspace_name: "Test legal",
        request_id: uid(20),
        subject: "Supplier NDA",
        kind: "new_request",
        change: "assign",
        actor_name: "person2@example.test",
        automated: false,
        channel: null,
        created_at: expect.any(String),
      },
    ]);
    // Collected once, by whichever tab asks first.
    expect(claim(3)).toEqual([]);
    // A retried command replays its receipt and tells nobody again.
    sql(cmd("assign", 2, 101, 1, `,${q(3)}`));
    expect(waiting()).toBe("0");
    // The assignee's own work tells nobody.
    sql(cmd("wait", 3, 102, 2));
    sql(note(3, 103, "Chasing the draft"));
    expect(waiting()).toBe("0");
    // Unassigning leaves nobody to tell.
    sql(cmd("assign", 2, 104, 3, ",null"));
    expect(waiting()).toBe("0");
  });
  it("tells the assignee about others' changes, MikeGC's and the requester's replies, as updates", () => {
    thread(21, 70, q(3));
    expect(claim(3)).toEqual([
      expect.objectContaining({
        kind: "new_request",
        change: "submitted",
        actor_name: null,
        automated: true,
      }),
    ]);
    sql(note(2, 110, "Looks routine", 21));
    // A note written with a status change is reported by the change.
    sql(`select public.intake_wait_request(${q(10)},${q(2)},${q(111)},${q(21)},1,'Need the draft');`);
    // The reply puts the request back to work in the same transaction.
    reply(400, 410);
    sql(`select public.intake_note_automated(${q(10)},${q(21)},${q(80)},'Summary','preprocessing');`);
    const updates = claim(3);
    expect(updates.map((n) => [n.kind, n.change])).toEqual([
      ["update", "note"],
      ["update", "wait"],
      ["update", "reply"],
      ["update", "resume"],
      ["update", "preprocessing"],
    ]);
    expect(updates[0]).toMatchObject({ actor_name: "person2@example.test", automated: false });
    expect(updates[2]).toMatchObject({ actor_name: "Jane Business", channel: "slack", automated: false });
    expect(updates[3]).toMatchObject({ actor_name: null, automated: true });
    expect(updates[4]).toMatchObject({ actor_name: null, automated: true });
    // One change's entries share its time, so a client can count changes.
    expect(updates[2].created_at).toBe(updates[3].created_at);
    expect(updates[1].created_at).not.toBe(updates[2].created_at);
    sql(cmd("edit", 2, 112, 3, ",'Supplier NDA v2','Please review','Jane Business','jane@acme.test',null,null", 21));
    sql(cmd("resolve", 2, 113, 4, ",'Signed off'", 21));
    sql(cmd("reopen", 4, 114, 5, "", 21));
    expect(claim(3).map((n) => [n.change, n.subject])).toEqual([
      ["edited", "Supplier NDA v2"],
      ["resolve", "Supplier NDA v2"],
      ["reopen", "Supplier NDA v2"],
    ]);
  });
  it("drops notifications for work that is no longer the recipient's", () => {
    sql(submit(100, { assignee: q(3) }));
    sql(cmd("assign", 2, 101, 1, `,${q(4)}`));
    // Reassigned before member 3 looked: theirs is deleted unseen.
    expect(claim(3)).toEqual([]);
    expect(waiting()).toBe("1");
    // A member who leaves hears nothing more from the organization.
    sql(`delete from public.org_members where org_id=${q(10)} and user_id=${q(4)}`);
    expect(waiting()).toBe("0");
    // Nobody collected it within a day: never shown, and swept.
    sql(submit(105, { request: 22, assignee: q(3) }));
    sql(submit(106, { request: 23, assignee: q(3) }));
    sql(`update public.intake_notifications set created_at = now() - interval '2 days' where request_id=${q(22)}`);
    expect(sql("select public.intake_expire_notifications()")).toBe("1");
    expect(claim(3).map((n) => n.request_id)).toEqual([uid(23)]);
    sql(submit(107, { request: 24, assignee: q(3) }));
    sql(`update public.intake_notifications set created_at = now() - interval '2 days'`);
    expect(claim(3)).toEqual([]);
    expect(waiting()).toBe("0");
  });
  it("names a personal workspace as personal, never by its organization", () => {
    const personal = sql(
      `select id from public.organizations where personal_user_id=${q(2)} and kind='personal'`,
    );
    sql(
      `select public.intake_submit_request('${personal}',${q(2)},${q(200)},${q(30)},'Lease renewal','Check the break clause',` +
        `'Me',null,null,null,${q(2)});`,
    );
    expect(claim(2)).toEqual([]);
    sql(`select public.intake_note_automated('${personal}',${q(30)},${q(81)},'Summary','preprocessing');`);
    expect(claim(2)).toEqual([
      expect.objectContaining({ workspace: "personal", workspace_name: "Personal", change: "preprocessing" }),
    ]);
  });
  it("deletes notifications with the account, the request and the organization's intake data", () => {
    sql(submit(100, { assignee: q(3) }));
    sql(`delete from auth.users where id=${q(3)}`);
    expect(waiting()).toBe("0");
    sql(submit(101, { request: 22, assignee: q(4) }));
    sql(cmd("delete", 2, 102, 1, "", 22));
    expect(waiting()).toBe("0");
    sql(submit(103, { request: 23, assignee: q(4) }));
    sql(`select public.intake_purge(${q(10)},${q(1)})`);
    expect(waiting()).toBe("0");
    expect(() => sql(`select public.intake_claim_notifications(${q(4)},0)`)).toThrow(/22023/);
  });
  it("writes notifications as the trusted owner and keeps them from browser roles", () => {
    for (const fn of ["intake_notify_event", "intake_notify_message", "intake_notification_departure"])
      expect(
        sql(`select count(*) from pg_proc p join pg_roles r on r.oid=p.proowner
        where p.oid='public.${fn}()'::regprocedure and p.prosecdef
        and r.rolname not in ('anon','authenticated','service_role','supabase_auth_admin')
        and 'search_path=pg_catalog, public, pg_temp'=any(p.proconfig)`),
      ).toBe("1");
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`select has_table_privilege('${role}','public.intake_notifications','SELECT')`)).toBe("f");
      expect(
        sql(`select has_function_privilege('${role}','public.intake_claim_notifications(uuid,integer)','EXECUTE')`),
      ).toBe("f");
    }
  });
});
