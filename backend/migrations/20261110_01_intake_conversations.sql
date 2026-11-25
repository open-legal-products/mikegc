-- Migration date: 2026-11-10

-- Chat threads where MikeGC answered instead of recording a request, so a
-- reply there without a mention still reaches it. `rounds` counts its
-- answers; after a few, the next message is recorded.
create table if not exists public.intake_conversations (
  org_id uuid not null references public.organizations(id) on delete cascade,
  source text not null check (source in ('slack', 'teams')),
  thread_key text not null check (char_length(thread_key) between 1 and 500),
  rounds integer not null default 1 check (rounds >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, source, thread_key)
);

alter table public.intake_conversations enable row level security;
revoke all on public.intake_conversations from public, anon, authenticated;
grant all on public.intake_conversations to service_role;

-- Purging intake forgets these threads too: they lead back to its messages.
create or replace function public.intake_purge(p_org uuid,p_actor uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
begin
  perform public.intake_lock_org(p_org,p_actor);
  if public.intake_member_role(p_org,p_actor)<>'owner' then raise exception 'Only the organization owner can delete intake data' using errcode='42501'; end if;
  insert into public.intake_purged_commands(org_id,actor_id,command_id)
    select org_id,actor_id,command_id from public.intake_commands
    where org_id=p_org and request_id is not null on conflict do nothing;
  delete from public.intake_requests where org_id=p_org;
  -- Messages received for intake hold request text too.
  delete from public.intake_inbound where org_id=p_org;
  delete from public.intake_conversations where org_id=p_org;
  insert into public.intake_events(org_id,actor_id,kind)
    select p_org,p_actor,'requests_purged' where exists(select 1 from public.intake_settings where org_id=p_org);
end $$;
revoke all on function public.intake_purge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.intake_purge(uuid, uuid) to service_role;
