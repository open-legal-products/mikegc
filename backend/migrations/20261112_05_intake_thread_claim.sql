-- Migration date: 2026-11-12
-- One request per Slack or Teams thread, even when several mentions in a
-- thread arrive before the first is recorded: each is stored as a new
-- request, since no link existed yet. Recording the request now links its
-- thread in the same call, and a message whose thread another request has
-- linked becomes that request's reply instead of a second request.

-- A new message in a thread another request has linked becomes that
-- request's reply: its kind, its request and its payload (p_reply, what the
-- reply branch reads) change together. Returns the request, or null when the
-- thread has no link or the message isn't a new one still waiting.
create or replace function public.intake_follow_thread(p_org uuid, p_inbound uuid, p_source text,
  p_thread_key text, p_reply jsonb)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare i public.intake_inbound; thread_owner uuid;
begin
  perform 1 from public.organizations where id = p_org and kind in ('team', 'personal')
    and deleted_at is null for update;
  if not found then raise exception 'Intake not found' using errcode = 'P0002'; end if;
  select * into i from public.intake_inbound where id = p_inbound and org_id = p_org for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if i.kind <> 'request' or i.status <> 'pending' or i.request_id is not null then return null; end if;
  if p_source is null or p_thread_key is null or p_reply is null or jsonb_typeof(p_reply) <> 'object' then
    raise exception 'Invalid thread' using errcode = '22023';
  end if;
  select request_id into thread_owner from public.intake_channel_links
    where org_id = p_org and source = p_source and thread_key = p_thread_key;
  if thread_owner is null then return null; end if;
  update public.intake_inbound set kind = 'reply', request_id = thread_owner, payload = p_reply,
    error = null, updated_at = now() where id = p_inbound;
  return thread_owner;
end $$;

-- A request MikeGC records from a received message. No member makes it, so
-- it has no creator and its "submitted" event is marked automated. Asking
-- again for the same message returns the request it already made. A
-- reviewer who is not a current member leaves the request unassigned.
-- With p_thread_key, the request's thread is linked in the same call; a
-- thread another request linked first makes the message that request's
-- reply (intake_follow_thread), and that request is returned instead.
drop function if exists public.intake_submit_automated(uuid, uuid, uuid, text, text, text, text, date, uuid);
create or replace function public.intake_submit_automated(p_org uuid, p_inbound uuid, p_request uuid,
  p_subject text, p_description text, p_requester_name text, p_requester_email text default null,
  p_date date default null, p_assignee uuid default null, p_source text default null,
  p_thread_key text default null, p_address jsonb default null, p_reply jsonb default null)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare i public.intake_inbound; next_state text; reviewer uuid := p_assignee; thread_owner uuid;
begin
  perform 1 from public.organizations where id = p_org and kind in ('team', 'personal')
    and deleted_at is null for update;
  if not found then raise exception 'Intake not found' using errcode = 'P0002'; end if;
  select * into i from public.intake_inbound where id = p_inbound and org_id = p_org for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if i.request_id is not null then return i.request_id; end if;
  if i.status <> 'pending' then raise exception 'Message already handled' using errcode = 'P0001'; end if;
  if p_request is null then raise exception 'Invalid request details' using errcode = '22023'; end if;
  if p_thread_key is not null then
    thread_owner := public.intake_follow_thread(p_org, p_inbound, p_source, p_thread_key, p_reply);
    if thread_owner is not null then return thread_owner; end if;
  end if;
  perform public.intake_check_details(p_subject, p_description, p_requester_name,
    p_requester_email, null);
  if reviewer is not null and public.intake_member_role(p_org, reviewer) is null then
    reviewer := null;
  end if;
  if exists(select 1 from public.intake_requests where id = p_request) then
    raise exception 'Request ID already used' using errcode = 'P0007';
  end if;
  insert into public.intake_settings(org_id) values(p_org) on conflict do nothing;
  next_state := case when reviewer is null then 'submitted' else 'in_review' end;
  insert into public.intake_requests(id, org_id, created_by, source, requester_name, requester_email,
      assignee_id, subject, description, requested_by_date, state)
    values(p_request, p_org, null, i.source, p_requester_name, p_requester_email,
      reviewer, p_subject, p_description, p_date, next_state);
  insert into public.intake_events(org_id, request_id, actor_id, kind, to_state, assignee_id, automated)
    values(p_org, p_request, null, 'submitted', next_state, reviewer, true);
  update public.intake_inbound set request_id = p_request, updated_at = now() where id = p_inbound;
  if p_thread_key is not null then
    insert into public.intake_channel_links(org_id, request_id, source, thread_key, address)
      values(p_org, p_request, p_source, p_thread_key, coalesce(p_address, '{}'::jsonb));
  end if;
  return p_request;
end $$;

-- Recreated functions start with default grants; only the backend's service
-- role may call them.
do $$ declare obj record; begin
  for obj in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('intake_submit_automated', 'intake_follow_thread') loop
    execute format('revoke all on function %s from public,anon,authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end $$;
