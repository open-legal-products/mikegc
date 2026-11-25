-- Migration date: 2026-11-11

-- The intake agent (docs/intake-agent-design.md): one loop that answers,
-- records, updates and assigns from a channel thread through checked tools.

-- The details a member has edited, which MikeGC never changes afterwards.
alter table public.intake_requests
  add column if not exists member_edited_fields text[] not null default '{}';
alter table public.intake_requests
  drop constraint if exists intake_requests_member_edited_fields_check;
alter table public.intake_requests
  add constraint intake_requests_member_edited_fields_check
  check (member_edited_fields <@ array['subject', 'description', 'requested_by_date']::text[]);

-- MikeGC's own answers in a thread with no request, oldest first, so the
-- next message there is read with them. Only MikeGC's words are kept here.
alter table public.intake_conversations
  add column if not exists replies jsonb not null default '[]'::jsonb;
alter table public.intake_conversations
  drop constraint if exists intake_conversations_replies_check;
alter table public.intake_conversations
  add constraint intake_conversations_replies_check
  check (jsonb_typeof(replies) = 'array' and octet_length(replies::text) <= 20000);

-- A member's edit also locks each detail it changed against MikeGC.
create or replace function public.intake_edit_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer,
  p_subject text, p_description text, p_requester_name text, p_requester_email text default null,
  p_requester_team text default null, p_date date default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; input jsonb; replay jsonb; receipt jsonb; extra jsonb; next_state text;
  edited text[];
begin
  perform public.intake_lock_org(p_org, p_actor);
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  input := jsonb_build_object('id', p_request, 'version', p_version, 'subject', p_subject,
    'description', p_description, 'requester_name', p_requester_name, 'requester_email', p_requester_email,
    'requester_team', p_requester_team, 'date', p_date);
  replay := public.intake_replay(p_org, p_actor, p_command, 'edit', input);
  if replay is not null then return replay; end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  if p_version is null or r.version <> p_version or r.state in ('resolved', 'cancelled') then
    raise exception 'Request changed; reload it' using errcode = 'P0001';
  end if;
  perform public.intake_check_details(p_subject, p_description, p_requester_name,
    p_requester_email, p_requester_team);
  -- Editing stops MikeGC asking; a request only it was waiting on goes back
  -- to work, as Stop asking does.
  next_state := case when r.clarify_stage is not null and r.state = 'needs_information'
    then case when r.assignee_id is null then 'submitted' else 'in_review' end else r.state end;
  edited := r.member_edited_fields;
  if p_subject is distinct from r.subject and not 'subject' = any(edited) then
    edited := edited || 'subject'::text;
  end if;
  if p_description is distinct from r.description and not 'description' = any(edited) then
    edited := edited || 'description'::text;
  end if;
  if p_date is distinct from r.requested_by_date and not 'requested_by_date' = any(edited) then
    edited := edited || 'requested_by_date'::text;
  end if;
  update public.intake_requests set subject = p_subject, description = p_description,
    requester_name = p_requester_name, requester_email = p_requester_email, requester_team = p_requester_team,
    requested_by_date = p_date, clarify_stage = null, clarify_stopped = true, state = next_state,
    member_edited_fields = edited,
    reply_seen_at = case when last_reply_at is null then reply_seen_at else now() end,
    version = version + 1, updated_at = now()
    where id = p_request;
  insert into public.intake_events(org_id, request_id, actor_id, kind, from_state, to_state, assignee_id)
    values(p_org, p_request, p_actor, 'edited', r.state, r.state, r.assignee_id);
  if next_state <> r.state then
    insert into public.intake_events(org_id, request_id, actor_id, kind, from_state, to_state, assignee_id)
      values(p_org, p_request, p_actor, 'stop_asking', r.state, next_state, r.assignee_id);
  end if;
  receipt := public.intake_record_command(p_org, p_actor, p_command, p_request, 'edit', input, r.version + 1);
  extra := jsonb_build_object('outbound_id', null, 'preprocess', r.clarify_stage = 'readiness');
  update public.intake_commands c set result = c.result || extra
    where c.org_id = p_org and c.actor_id = p_actor and c.command_id = p_command;
  return receipt || extra;
end $$;

-- MikeGC changes an open request's subject, description or due date from
-- what the requester wrote, skipping any detail a member has edited, and
-- says so in a note. p_lines names each change for the note, by field. The
-- caller names the note, so a retry adds nothing. Returns the fields changed.
create or replace function public.intake_update_automated(p_org uuid, p_request uuid, p_note uuid,
  p_subject text default null, p_description text default null, p_date date default null,
  p_lines jsonb default '{}'::jsonb)
returns text[] language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; applied text[] := '{}'; lines text[] := '{}'; field text; said text;
  next_subject text; next_description text; next_date date;
begin
  perform 1 from public.organizations where id = p_org and kind in ('team', 'personal')
    and deleted_at is null for update;
  if not found then raise exception 'Intake not found' using errcode = 'P0002'; end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if p_note is null or p_lines is null or jsonb_typeof(p_lines) <> 'object' then
    raise exception 'Invalid update' using errcode = '22023';
  end if;
  if exists(select 1 from public.intake_messages where id = p_note) then return applied; end if;
  if r.state in ('resolved', 'cancelled') then return applied; end if;
  next_subject := r.subject;
  next_description := r.description;
  next_date := r.requested_by_date;
  if p_subject is not null and p_subject is distinct from r.subject
      and not 'subject' = any(r.member_edited_fields) then
    next_subject := p_subject;
    applied := applied || 'subject'::text;
  end if;
  if p_description is not null and p_description is distinct from r.description
      and not 'description' = any(r.member_edited_fields) then
    next_description := p_description;
    applied := applied || 'description'::text;
  end if;
  if p_date is not null and p_date is distinct from r.requested_by_date
      and not 'requested_by_date' = any(r.member_edited_fields) then
    next_date := p_date;
    applied := applied || 'requested_by_date'::text;
  end if;
  if cardinality(applied) = 0 then return applied; end if;
  perform public.intake_check_details(next_subject, next_description, r.requester_name,
    r.requester_email, r.requester_team);
  foreach field in array applied loop
    said := btrim(coalesce(p_lines->>field, ''));
    if said <> '' then lines := lines || left(said, 400); end if;
  end loop;
  said := case cardinality(lines)
    when 0 then 'the details'
    when 1 then lines[1]
    when 2 then lines[1] || ' and ' || lines[2]
    else lines[1] || ', ' || lines[2] || ' and ' || lines[3] end;
  update public.intake_requests set subject = next_subject, description = next_description,
    requested_by_date = next_date, version = version + 1, updated_at = now()
    where id = p_request;
  insert into public.intake_messages(id, org_id, request_id, author_id, kind, body, automated)
    values(p_note, p_org, p_request, null, 'note',
      'Updated ' || said || ' from the requester''s reply.', true);
  return applied;
end $$;

-- Recreated and new functions start with default grants; only the backend's
-- service role may call them.
do $$ declare obj record; begin
  for obj in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('intake_edit_request', 'intake_update_automated') loop
    execute format('revoke all on function %s from public,anon,authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end $$;
