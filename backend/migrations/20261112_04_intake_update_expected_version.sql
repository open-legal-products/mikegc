-- Migration date: 2026-11-12
-- An automated update planned from an older state of a request (a reply's
-- plan, retried after a newer reply or a member changed the request) must
-- not overwrite the newer details: the caller passes the version it planned
-- from, and a changed request refuses the update so the plan is made again.
-- MikeGC changes an open request's subject, description or due date from
-- what the requester wrote, skipping any detail a member has edited, and
-- says so in a note. p_lines names each change for the note, by field. The
-- caller names the note, so a retry adds nothing. p_version is the request's
-- version the change was planned from: once anything has changed the request
-- since (a newer reply, a member), the plan is stale and refused (P0001), so
-- it never overwrites newer details. Returns the fields changed.
drop function if exists public.intake_update_automated(uuid, uuid, uuid, text, text, date, jsonb);
create or replace function public.intake_update_automated(p_org uuid, p_request uuid, p_note uuid,
  p_subject text default null, p_description text default null, p_date date default null,
  p_lines jsonb default '{}'::jsonb, p_version integer default null)
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
  if p_version is not null and r.version <> p_version then
    raise exception 'Request changed' using errcode = 'P0001';
  end if;
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

-- Recreated functions start with default grants; only the backend's service
-- role may call them.
do $$ declare obj record; begin
  for obj in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'intake_update_automated' loop
    execute format('revoke all on function %s from public,anon,authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end $$;
