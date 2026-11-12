-- Migration date: 2026-11-11

-- MikeGC answers the requester in a request's thread: it acknowledges what
-- they wrote, says what it added to the request, or answers their question.
-- Unlike a question, the request doesn't wait on the requester. The caller
-- names the message and its outbox row, so a retry adds nothing. False when
-- the request is closed or has no thread to answer in.
create or replace function public.intake_answer_automated(p_org uuid, p_request uuid, p_outbound uuid,
  p_message uuid, p_body text)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; link uuid;
begin
  perform 1 from public.organizations where id = p_org and kind in ('team', 'personal')
    and deleted_at is null for update;
  if not found then raise exception 'Intake not found' using errcode = 'P0002'; end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if p_message is null or p_outbound is null
    or p_body is null or char_length(p_body) not between 1 and 20000 or btrim(p_body) = '' then
    raise exception 'Invalid answer' using errcode = '22023';
  end if;
  if exists(select 1 from public.intake_messages where id = p_message) then return true; end if;
  select id into link from public.intake_channel_links where org_id = p_org and request_id = p_request;
  if link is null or r.state in ('resolved', 'cancelled') then return false; end if;
  insert into public.intake_messages(id, org_id, request_id, author_id, kind, body, automated)
    values(p_message, p_org, p_request, null, 'answer', p_body, true);
  insert into public.intake_outbound(id, org_id, request_id, link_id, message_id, kind)
    values(p_outbound, p_org, p_request, link, p_message, 'answer');
  return true;
end $$;

-- A new function starts with default grants; only the backend's service role
-- may call it.
do $$ declare obj record; begin
  for obj in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'intake_answer_automated' loop
    execute format('revoke all on function %s from public,anon,authenticated', obj.signature);
    execute format('grant execute on function %s to service_role', obj.signature);
  end loop;
end $$;
