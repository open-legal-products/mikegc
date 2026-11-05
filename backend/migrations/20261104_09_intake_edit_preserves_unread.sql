-- Migration date: 2026-11-04
-- Editing request metadata is human takeover, not acknowledgement that its
-- requester replies were read. Preserve the explicit Messages watermark.

create or replace function public.intake_edit_request(p_org uuid, p_actor uuid, p_command uuid, p_request uuid, p_version integer,
  p_subject text, p_description text, p_requester_name text, p_requester_email text default null,
  p_requester_team text default null, p_date date default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; input jsonb; replay jsonb; receipt jsonb; extra jsonb; next_state text;
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
  -- to work, as Stop asking does. Metadata changes do not mean the
  -- requester replies were read; their explicit seen watermark stays intact.
  next_state := case when r.clarify_stage is not null and r.state = 'needs_information'
    then case when r.assignee_id is null then 'submitted' else 'in_review' end else r.state end;
  update public.intake_requests set subject = p_subject, description = p_description,
    requester_name = p_requester_name, requester_email = p_requester_email, requester_team = p_requester_team,
    requested_by_date = p_date, clarify_stage = null, clarify_stopped = true, state = next_state,
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

-- Preserve the backend-only command boundary, including on a fresh create.
revoke all on function public.intake_edit_request(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,date)
  from public,anon,authenticated;
grant execute on function public.intake_edit_request(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,date)
  to service_role;
