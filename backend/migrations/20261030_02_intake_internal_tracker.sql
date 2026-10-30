-- Migration date: 2026-10-30
-- Intake becomes the Legal team's internal request tracker. Every current
-- member of a team organization is Legal, so the reviewer roster and its
-- departure trigger are retired, and intake is always on, so the on/off
-- setting is retired too. Members record requests on behalf of named business
-- requesters, who are plain records rather than accounts, and the shared
-- answer flow becomes notes, resolutions and cancel reasons. Stored states are
-- unchanged; an existing request's creator becomes its requester.
-- Also supports replay against a local database that ran an unshipped draft.

-- Requester details are business records, not MikeGC identities.
alter table public.intake_requests add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.intake_requests add column if not exists requester_name text;
alter table public.intake_requests add column if not exists requester_email text;
alter table public.intake_requests add column if not exists requester_team text;
update public.intake_requests r set
  created_by = r.requester_id,
  requester_name = coalesce(
    (select left(coalesce(nullif(btrim(u.display_name), ''), u.email), 200)
       from public.user_profiles u where u.user_id = r.requester_id),
    'Former member'),
  requester_email = (select u.email from public.user_profiles u where u.user_id = r.requester_id)
where r.requester_name is null;
alter table public.intake_requests alter column requester_name set not null;
alter table public.intake_requests drop constraint if exists intake_requests_requester_check;
alter table public.intake_requests add constraint intake_requests_requester_check check (
  char_length(requester_name) between 1 and 200 and btrim(requester_name) <> ''
  and (requester_email is null or (char_length(requester_email) between 3 and 320
    and requester_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'))
  and (requester_team is null or (char_length(requester_team) between 1 and 200 and btrim(requester_team) <> ''))
);
create index if not exists intake_requests_created_by on public.intake_requests(created_by, org_id);
create index if not exists intake_requests_org_updated on public.intake_requests(org_id, updated_at desc, id desc);
create index if not exists intake_requests_org_target on public.intake_requests(org_id, requested_by_date, id);

-- Legacy question, reply and answer messages stay readable as notes.
alter table public.intake_messages drop constraint if exists intake_messages_kind_check;
alter table public.intake_messages add constraint intake_messages_kind_check
  check (kind in ('note', 'resolution', 'cancel_reason', 'question', 'reply', 'answer'));

-- intake_settings remains only as each organization's intake anchor.
alter table public.intake_settings drop column if exists enabled;
alter table public.intake_settings drop column if exists revision;

-- Retire the roster, the switch, the requester-facing commands and the
-- account export.
drop table if exists public.intake_reviewers cascade;
drop function if exists public.intake_reviewer_departure();
drop function if exists public.intake_roster(uuid, uuid);
drop function if exists public.intake_is_reviewer(uuid, uuid);
drop function if exists public.intake_configure(uuid, uuid, uuid, integer, boolean, uuid[]);
drop function if exists public.intake_configure(uuid, uuid, uuid, integer, boolean);
drop function if exists public.intake_configuration(uuid, uuid);
drop function if exists public.intake_list_item(public.intake_requests, boolean);
drop function if exists public.intake_submit_request(uuid, uuid, uuid, uuid, text, text, text, date, text);
drop function if exists public.intake_ask_request(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.intake_reply_request(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.intake_publish_request(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.intake_cancel_request(uuid, uuid, uuid, uuid, integer);
drop function if exists public.intake_list_requests(uuid, uuid, text, text, uuid, text, integer, integer);
-- Signatures from unshipped drafts of this migration, before the type filter.
drop function if exists public.intake_list_requests(uuid, uuid, text, text, text, text, text, uuid, integer);
drop function if exists public.intake_list_matches(public.intake_requests, text, boolean, uuid, text);
drop function if exists public.intake_export_requests(uuid, uuid, integer);

-- Every current member of a live team organization reads the whole queue.
create or replace function public.intake_can_read(p_org uuid, p_actor uuid, p_request uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select public.intake_member_role(p_org, p_actor) is not null
    and exists(select 1 from public.intake_requests where org_id = p_org and id = p_request)
$$;

-- A reused command is a client error, distinct from a concurrent change.
create or replace function public.intake_replay(p_org uuid, p_actor uuid, p_command uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c public.intake_commands;
begin
  if p_command is null then raise exception 'Command ID is required' using errcode = '22023'; end if;
  if exists(select 1 from public.intake_purged_commands
    where org_id = p_org and actor_id = p_actor and command_id = p_command) then
    raise exception 'The command belongs to purged request data' using errcode = 'P0004';
  end if;
  select * into c from public.intake_commands
    where org_id = p_org and actor_id = p_actor and command_id = p_command;
  if not found then return null; end if;
  if c.action <> p_action or c.input <> p_input then
    raise exception 'Command was already used for different input' using errcode = 'P0007';
  end if;
  return c.result || '{"replayed":true}'::jsonb;
end $$;

-- Cheaper than scanning pg_timezone_names on every dated request.
create or replace function public.intake_valid_timezone(p_timezone text)
returns boolean language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform now() at time zone p_timezone;
  return true;
exception when invalid_parameter_value then
  return false;
end $$;

create or replace function public.intake_check_details(p_category text, p_subject text, p_description text,
  p_requester_name text, p_requester_email text, p_requester_team text, p_date date, p_timezone text)
returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_category is null or p_category not in ('nda', 'general')
    or p_subject is null or char_length(p_subject) not between 1 and 200 or btrim(p_subject) = ''
    or p_description is null or char_length(p_description) not between 1 and 20000 or btrim(p_description) = ''
    or p_requester_name is null or char_length(p_requester_name) not between 1 and 200 or btrim(p_requester_name) = ''
    or (p_requester_email is not null and (char_length(p_requester_email) not between 3 and 320
      or p_requester_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'))
    or (p_requester_team is not null and (char_length(p_requester_team) not between 1 and 200 or btrim(p_requester_team) = ''))
    or ((p_date is null) <> (p_timezone is null))
    or (p_timezone is not null and not public.intake_valid_timezone(p_timezone))
  then
    raise exception 'Invalid request details' using errcode = '22023';
  end if;
end $$;

-- A member who leaves the organization stops owning its open requests. GoTrue
-- account deletion cascades here as supabase_auth_admin, so the trigger runs as
-- its trusted owner; it only changes requests assigned to the departing row.
create or replace function public.intake_member_departure()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare r public.intake_requests; next_state text;
begin
  -- Same first lock as intake commands, so departure cannot deadlock them.
  perform 1 from public.organizations where id = old.org_id for update;
  if not found then return old; end if;
  for r in select * from public.intake_requests where org_id = old.org_id and assignee_id = old.user_id
    and state not in ('resolved', 'cancelled') order by id for update loop
    next_state := case when r.state = 'in_review' then 'submitted' else r.state end;
    update public.intake_requests set assignee_id = null, state = next_state,
      version = version + 1, updated_at = now() where id = r.id;
    insert into public.intake_events(org_id, request_id, kind, from_state, to_state, assignee_id)
      values(old.org_id, r.id, 'assignee_left', r.state, next_state, old.user_id);
  end loop;
  return old;
end $$;
drop trigger if exists intake_member_departure on public.org_members;
create trigger intake_member_departure after delete on public.org_members
  for each row execute function public.intake_member_departure();

-- People a request can be assigned to.
create or replace function public.intake_members(p_org uuid, p_actor uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.organizations where id = p_org for share;
  if public.intake_member_role(p_org, p_actor) is null then
    raise exception 'Intake not found' using errcode = 'P0002';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', u.display_name, 'email', u.email)
      order by lower(coalesce(u.display_name, u.email, '')), m.user_id), '[]')
    from public.org_members m join public.user_profiles u on u.user_id = m.user_id
    where m.org_id = p_org and u.account_deletion_requested_at is null);
end $$;

create or replace function public.intake_submit_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid,
  p_category text, p_subject text, p_description text, p_requester_name text, p_requester_email text default null,
  p_requester_team text default null, p_date date default null, p_timezone text default null, p_assignee uuid default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare input jsonb; replay jsonb; next_state text;
begin
  perform public.intake_lock_org(p_org, p_actor);
  input := jsonb_build_object('id', p_request, 'category', p_category, 'subject', p_subject,
    'description', p_description, 'requester_name', p_requester_name, 'requester_email', p_requester_email,
    'requester_team', p_requester_team, 'date', p_date, 'timezone', p_timezone, 'assignee', p_assignee);
  replay := public.intake_replay(p_org, p_actor, p_command, 'submit', input);
  if replay is not null then
    if not public.intake_can_read(p_org, p_actor, p_request) then
      raise exception 'Request not found' using errcode = 'P0002';
    end if;
    return replay;
  end if;
  if p_request is null then raise exception 'Invalid request details' using errcode = '22023'; end if;
  perform public.intake_check_details(p_category, p_subject, p_description, p_requester_name,
    p_requester_email, p_requester_team, p_date, p_timezone);
  if p_assignee is not null and public.intake_member_role(p_org, p_assignee) is null then
    raise exception 'Choose a current member of your organization' using errcode = '22023';
  end if;
  if exists(select 1 from public.intake_requests where id = p_request) then
    raise exception 'Request ID already used' using errcode = 'P0007';
  end if;
  -- The organization's intake anchor is created with its first request.
  insert into public.intake_settings(org_id) values(p_org) on conflict do nothing;
  next_state := case when p_assignee is null then 'submitted' else 'in_review' end;
  insert into public.intake_requests(id, org_id, created_by, requester_name, requester_email, requester_team,
      assignee_id, category, subject, description, requested_by_date, timezone, state)
    values(p_request, p_org, p_actor, p_requester_name, p_requester_email, p_requester_team,
      p_assignee, p_category, p_subject, p_description, p_date, p_timezone, next_state);
  insert into public.intake_events(org_id, request_id, actor_id, kind, to_state, assignee_id)
    values(p_org, p_request, p_actor, 'submitted', next_state, p_assignee);
  return public.intake_record_command(p_org, p_actor, p_command, p_request, 'submit', input, 1);
end $$;

-- Internal common transaction boundary for every state and activity change.
-- Only the explicit wrappers below are called by the API.
create or replace function public.intake_change_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid,
  p_version integer, p_action text, p_body text default null, p_assignee uuid default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; input jsonb; replay jsonb; next_state text; next_assignee uuid; mid uuid; open boolean;
begin
  perform public.intake_lock_org(p_org, p_actor);
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  input := jsonb_build_object('id', p_request, 'version', p_version, 'body', p_body, 'assignee', p_assignee);
  -- Resolve committed operations before checking state the original operation
  -- itself may have changed.
  replay := public.intake_replay(p_org, p_actor, p_command, p_action, input);
  if replay is not null then return replay; end if;
  if p_action is null or p_action not in ('assign', 'note', 'wait', 'resume', 'resolve', 'cancel', 'reopen')
    or (p_action <> 'assign' and p_assignee is not null)
    or (p_action in ('assign', 'reopen') and p_body is not null)
    or (p_action in ('note', 'resolve', 'cancel') and p_body is null)
  then
    raise exception 'Invalid command' using errcode = '22023';
  end if;
  if p_body is not null and (char_length(p_body) not between 1 and 20000 or btrim(p_body) = '') then
    raise exception 'Enter at most 20000 characters' using errcode = '22023';
  end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  -- Notes leave the request itself unchanged, so they never conflict.
  if p_action <> 'note' and (p_version is null or r.version <> p_version) then
    raise exception 'Request changed; reload it' using errcode = 'P0001';
  end if;
  open := r.state not in ('resolved', 'cancelled');
  next_state := r.state;
  next_assignee := r.assignee_id;
  if (p_action in ('assign', 'resolve', 'cancel') and not open)
    or (p_action = 'wait' and r.state not in ('submitted', 'in_review'))
    or (p_action = 'resume' and r.state <> 'needs_information')
    or (p_action = 'reopen' and open)
  then
    raise exception 'Request changed; reload it' using errcode = 'P0001';
  end if;
  if p_action = 'assign' then
    if p_assignee is not null and public.intake_member_role(p_org, p_assignee) is null then
      raise exception 'Choose a current member of your organization' using errcode = '22023';
    end if;
    next_assignee := p_assignee;
    if r.state in ('submitted', 'in_review') then
      next_state := case when p_assignee is null then 'submitted' else 'in_review' end;
    end if;
  elsif p_action = 'wait' then
    next_state := 'needs_information';
  elsif p_action = 'resume' then
    next_state := case when r.assignee_id is null then 'submitted' else 'in_review' end;
  elsif p_action = 'resolve' then
    next_state := 'resolved';
  elsif p_action = 'cancel' then
    next_state := 'cancelled';
  elsif p_action = 'reopen' then
    if r.assignee_id is not null and public.intake_member_role(p_org, r.assignee_id) is null then
      next_assignee := null;
    end if;
    next_state := case when next_assignee is null then 'submitted' else 'in_review' end;
  end if;
  if p_body is not null then
    insert into public.intake_messages(org_id, request_id, author_id, kind, body)
      values(p_org, p_request, p_actor,
        case p_action when 'resolve' then 'resolution' when 'cancel' then 'cancel_reason' else 'note' end, p_body)
      returning id into mid;
  end if;
  if p_action = 'note' then
    update public.intake_requests set updated_at = now() where id = p_request;
    return public.intake_record_command(p_org, p_actor, p_command, p_request, p_action, input, r.version, mid);
  end if;
  update public.intake_requests set state = next_state, assignee_id = next_assignee,
    version = version + 1, updated_at = now() where id = p_request;
  insert into public.intake_events(org_id, request_id, actor_id, kind, from_state, to_state, assignee_id, message_id)
    values(p_org, p_request, p_actor, p_action, r.state, next_state, next_assignee, mid);
  return public.intake_record_command(p_org, p_actor, p_command, p_request, p_action, input, r.version + 1, mid);
end $$;

create or replace function public.intake_assign_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer, p_assignee uuid)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'assign', null, p_assignee)
$$;

create or replace function public.intake_note_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_body text)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, null, 'note', p_body, null)
$$;

create or replace function public.intake_wait_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer, p_body text default null)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'wait', p_body, null)
$$;

create or replace function public.intake_resume_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer, p_body text default null)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'resume', p_body, null)
$$;

create or replace function public.intake_resolve_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer, p_body text)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'resolve', p_body, null)
$$;

create or replace function public.intake_cancel_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer, p_body text)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'cancel', p_body, null)
$$;

create or replace function public.intake_reopen_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.intake_change_request(p_org, p_actor, p_command, p_request, p_version, 'reopen', null, null)
$$;

create or replace function public.intake_edit_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer,
  p_category text, p_subject text, p_description text, p_requester_name text, p_requester_email text default null,
  p_requester_team text default null, p_date date default null, p_timezone text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; input jsonb; replay jsonb;
begin
  perform public.intake_lock_org(p_org, p_actor);
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  input := jsonb_build_object('id', p_request, 'version', p_version, 'category', p_category, 'subject', p_subject,
    'description', p_description, 'requester_name', p_requester_name, 'requester_email', p_requester_email,
    'requester_team', p_requester_team, 'date', p_date, 'timezone', p_timezone);
  replay := public.intake_replay(p_org, p_actor, p_command, 'edit', input);
  if replay is not null then return replay; end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  if p_version is null or r.version <> p_version or r.state in ('resolved', 'cancelled') then
    raise exception 'Request changed; reload it' using errcode = 'P0001';
  end if;
  perform public.intake_check_details(p_category, p_subject, p_description, p_requester_name,
    p_requester_email, p_requester_team, p_date, p_timezone);
  update public.intake_requests set category = p_category, subject = p_subject, description = p_description,
    requester_name = p_requester_name, requester_email = p_requester_email, requester_team = p_requester_team,
    requested_by_date = p_date, timezone = p_timezone, version = version + 1, updated_at = now()
    where id = p_request;
  insert into public.intake_events(org_id, request_id, actor_id, kind, from_state, to_state, assignee_id)
    values(p_org, p_request, p_actor, 'edited', r.state, r.state, r.assignee_id);
  return public.intake_record_command(p_org, p_actor, p_command, p_request, 'edit', input, r.version + 1);
end $$;

create or replace function public.intake_request_view(p_org uuid, p_actor uuid, p_request uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'org_id', r.org_id, 'category', r.category, 'subject', r.subject, 'description', r.description,
    'requester_name', r.requester_name, 'requester_email', r.requester_email, 'requester_team', r.requester_team,
    'requested_by_date', r.requested_by_date, 'timezone', r.timezone, 'state', r.state, 'version', r.version,
    'assignee_id', r.assignee_id,
    'assignee_name', case when r.assignee_id is null then null else coalesce(a.display_name, a.email, 'Former member') end,
    'created_by_name', coalesce(c.display_name, c.email, 'Former member'),
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'capabilities', jsonb_build_object(
      'edit', r.state not in ('resolved', 'cancelled'),
      'assign', r.state not in ('resolved', 'cancelled'),
      'note', true,
      'wait', r.state in ('submitted', 'in_review'),
      'resume', r.state = 'needs_information',
      'resolve', r.state not in ('resolved', 'cancelled'),
      'cancel', r.state not in ('resolved', 'cancelled'),
      'reopen', r.state in ('resolved', 'cancelled')))
  from public.intake_requests r
  left join public.user_profiles c on c.user_id = r.created_by
  left join public.user_profiles a on a.user_id = r.assignee_id
  where r.id = p_request and r.org_id = p_org and public.intake_can_read(p_org, p_actor, p_request)
$$;

-- List rows omit the description, which the queue never shows.
create or replace function public.intake_list_item(r public.intake_requests)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'category', r.category, 'subject', r.subject,
    'requester_name', r.requester_name, 'requester_email', r.requester_email, 'requester_team', r.requester_team,
    'requested_by_date', r.requested_by_date, 'timezone', r.timezone, 'state', r.state, 'version', r.version,
    'assignee_id', r.assignee_id,
    'assignee_name', case when r.assignee_id is null then null else coalesce(
      (select coalesce(a.display_name, a.email) from public.user_profiles a where a.user_id = r.assignee_id),
      'Former member') end,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'capabilities', jsonb_build_object(
      'assign', r.state not in ('resolved', 'cancelled'),
      'cancel', r.state not in ('resolved', 'cancelled')))
$$;

create or replace function public.intake_list_matches(r public.intake_requests, p_state text,
  p_unassigned boolean, p_assignee uuid, p_search text, p_category text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select (p_state is null or r.state = p_state)
    and (p_category is null or r.category = p_category)
    and (not p_unassigned or r.assignee_id is null)
    and (p_assignee is null or r.assignee_id = p_assignee)
    and (p_search = ''
      or strpos(lower(r.subject), lower(p_search)) > 0
      or strpos(lower(r.description), lower(p_search)) > 0
      or strpos(lower(r.requester_name), lower(p_search)) > 0
      or strpos(lower(coalesce(r.requester_email, '')), lower(p_search)) > 0
      or strpos(lower(coalesce(r.requester_team, '')), lower(p_search)) > 0)
$$;

-- Keyset pages: a request created or updated between pages is never repeated.
-- p_assignee is null (everyone), 'unassigned', 'me' or a member's user ID.
-- p_category is null (every type), 'nda' (contract review) or 'general'.
create or replace function public.intake_list_requests(p_org uuid, p_actor uuid, p_state text default null,
  p_assignee text default null, p_search text default '', p_sort text default 'updated',
  p_after_key text default null, p_after_id uuid default null, p_limit integer default 50,
  p_category text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare unassigned boolean; assignee uuid; after_at timestamptz; after_date date;
  page jsonb; more boolean; last jsonb;
begin
  perform 1 from public.organizations where id = p_org for share;
  if public.intake_member_role(p_org, p_actor) is null then
    raise exception 'Intake not found' using errcode = 'P0002';
  end if;
  if p_sort is null or p_sort not in ('updated', 'target')
    or p_limit is null or p_limit not between 1 and 100
    or p_search is null or char_length(p_search) > 200
    or (p_state is not null and p_state not in ('submitted', 'in_review', 'needs_information', 'resolved', 'cancelled'))
    or (p_category is not null and p_category not in ('nda', 'general'))
    or (p_after_id is null and p_after_key is not null)
    or (p_sort = 'updated' and p_after_id is not null and p_after_key is null)
  then
    raise exception 'Invalid request filter' using errcode = '22023';
  end if;
  unassigned := coalesce(p_assignee = 'unassigned', false);
  assignee := case when p_assignee is null or unassigned then null
    when p_assignee = 'me' then p_actor else p_assignee::uuid end;
  if p_sort = 'updated' then
    after_at := p_after_key::timestamptz;
    select coalesce(jsonb_agg(x.item order by x.n) filter (where x.n <= p_limit), '[]'), coalesce(max(x.n), 0) > p_limit
      into page, more
      from (select public.intake_list_item(r) as item,
          row_number() over (order by r.updated_at desc, r.id desc) as n
        from public.intake_requests r
        where r.org_id = p_org and public.intake_list_matches(r, p_state, unassigned, assignee, p_search, p_category)
          and (p_after_id is null or (r.updated_at, r.id) < (after_at, p_after_id))
        order by r.updated_at desc, r.id desc limit p_limit + 1) x;
  else
    after_date := p_after_key::date;
    select coalesce(jsonb_agg(x.item order by x.n) filter (where x.n <= p_limit), '[]'), coalesce(max(x.n), 0) > p_limit
      into page, more
      from (select public.intake_list_item(r) as item,
          row_number() over (order by r.requested_by_date asc nulls last, r.id asc) as n
        from public.intake_requests r
        where r.org_id = p_org and public.intake_list_matches(r, p_state, unassigned, assignee, p_search, p_category)
          and (p_after_id is null
            or (after_date is null and r.requested_by_date is null and r.id > p_after_id)
            or (after_date is not null and (r.requested_by_date is null or r.requested_by_date > after_date
              or (r.requested_by_date = after_date and r.id > p_after_id))))
        order by r.requested_by_date asc nulls last, r.id asc limit p_limit + 1) x;
  end if;
  last := page -> -1;
  return jsonb_build_object('requests', page, 'next', case when more then jsonb_build_object(
    'key', last ->> (case when p_sort = 'updated' then 'updated_at' else 'requested_by_date' end),
    'id', last ->> 'id') end);
end $$;

-- System changes have no actor; erased people read as former members.
create or replace function public.intake_read_history(p_org uuid, p_actor uuid, p_request uuid,
  p_events boolean default false, p_offset integer default 0, p_limit integer default 50)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.organizations where id = p_org for share;
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  if p_events then
    return (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
      select e.id, e.kind, e.from_state, e.to_state, e.created_at,
        case when e.kind in ('assignee_left', 'reviewer_removed') then null
          else coalesce(u.display_name, u.email, 'Former member') end as actor_name,
        case when e.assignee_id is null then null else coalesce(a.display_name, a.email, 'Former member') end as assignee_name
      from public.intake_events e
      left join public.user_profiles u on u.user_id = e.actor_id
      left join public.user_profiles a on a.user_id = e.assignee_id
      where e.org_id = p_org and e.request_id = p_request
      order by e.id offset p_offset limit p_limit) x);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]') from (
    select m.id, m.kind, m.body, m.created_at, coalesce(u.display_name, u.email, 'Former member') as author_name
    from public.intake_messages m left join public.user_profiles u on u.user_id = m.author_id
    where m.org_id = p_org and m.request_id = p_request
    order by m.created_at, m.id offset p_offset limit p_limit) x);
end $$;

-- Erasure clears every reference to the account, including request creators.
create or replace function public.intake_erase_identity(p_actor uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  -- Find affected organizations through user-leading indexes, including former
  -- contributors whose only remaining identity is in history or a receipt.
  perform o.id from public.organizations o where o.id in (
    select org_id from public.intake_requests where requester_id = p_actor
    union select org_id from public.intake_requests where created_by = p_actor
    union select org_id from public.intake_requests where assignee_id = p_actor
    union select org_id from public.intake_messages where author_id = p_actor
    union select org_id from public.intake_events where actor_id = p_actor or assignee_id = p_actor
    union select org_id from public.intake_commands where actor_id = p_actor or input ->> 'assignee' = p_actor::text
      or (input -> 'reviewers') @> to_jsonb(array[p_actor])
    union select org_id from public.intake_purged_commands where actor_id = p_actor
  ) order by o.id for update;
  -- Older export artifacts carry export_revision; invalidate them before
  -- deleting any attribution they serialized.
  update public.intake_requests set export_revision = export_revision + 1,
    version = version + 1, updated_at = now() where id in (
      select id from public.intake_requests where requester_id = p_actor or created_by = p_actor or assignee_id = p_actor
      union select request_id from public.intake_messages where author_id = p_actor
      union select request_id from public.intake_events where actor_id = p_actor or assignee_id = p_actor
    );
  insert into public.intake_events(org_id, request_id, kind, from_state, to_state)
    select org_id, id, 'assignee_left', state, case when state = 'in_review' then 'submitted' else state end
    from public.intake_requests where assignee_id = p_actor and state not in ('resolved', 'cancelled');
  delete from public.intake_purged_commands where actor_id = p_actor;
  -- Receipts embed typed command input. Delete references to the erased person
  -- as well as their own receipts, instead of leaving their ID in opaque JSON.
  delete from public.intake_commands where actor_id = p_actor or input ->> 'assignee' = p_actor::text
    or (input -> 'reviewers') @> to_jsonb(array[p_actor]);
  update public.intake_requests set requester_id = null where requester_id = p_actor;
  update public.intake_requests set created_by = null where created_by = p_actor;
  update public.intake_requests set assignee_id = null,
    state = case when state = 'in_review' then 'submitted' else state end
    where assignee_id = p_actor;
  update public.intake_messages set author_id = null where author_id = p_actor;
  update public.intake_events set actor_id = null where actor_id = p_actor;
  update public.intake_events set assignee_id = null where assignee_id = p_actor;
end $$;

-- Tables and functions are inaccessible to browser database roles, even if
-- default Supabase grants change. The backend service role supplies the actor.
do $$ declare obj record; begin
  for obj in select tablename from pg_tables where schemaname = 'public' and tablename like 'intake_%' loop
    execute format('alter table public.%I enable row level security', obj.tablename);
    execute format('revoke all on public.%I from public,anon,authenticated', obj.tablename);
    execute format('grant all on public.%I to service_role', obj.tablename);
  end loop;
  for obj in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'intake_%' loop
    execute format('revoke all on function %s from public,anon,authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end $$;
