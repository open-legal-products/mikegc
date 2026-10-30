-- Migration date: 2026-10-30
-- Contract review requests carry documents. Each upload becomes a document of
-- library kind 'intake_attachment', owned by the request's organization and
-- linked to the request. Attachments never appear in the Library, are not a
-- departing member's private work, and every current member can read them.
-- Removing a request removes its documents and queues their storage cleanup.
alter table public.documents drop constraint if exists documents_library_kind_check;
alter table public.documents add constraint documents_library_kind_check
    check (library_kind in ('file', 'template', 'workflow_asset', 'intake_attachment'));

create table if not exists public.intake_request_documents (
  org_id uuid not null,
  request_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, document_id),
  unique (document_id),
  foreign key (org_id, request_id) references public.intake_requests(org_id, id) on delete cascade
);
create index if not exists intake_request_documents_org on public.intake_request_documents(org_id, request_id);
create index if not exists intake_request_documents_added_by on public.intake_request_documents(added_by);

-- An attachment's file belongs to its request. Removing the link (deleting
-- the request, an intake purge or organization purge) deletes the document,
-- and the version cleanup trigger queues its storage objects for deletion.
create or replace function public.intake_attachment_detached()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  delete from public.documents where id = old.document_id and library_kind = 'intake_attachment';
  return old;
end $$;
drop trigger if exists intake_attachment_detached on public.intake_request_documents;
create trigger intake_attachment_detached after delete on public.intake_request_documents
  for each row execute function public.intake_attachment_detached();

-- The upload worker links each new document as soon as its row exists, so an
-- interrupted browser never leaves a file that belongs to no request.
create or replace function public.intake_attach_document(p_org uuid, p_actor uuid, p_request uuid, p_document uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.intake_lock_org(p_org, p_actor);
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if not exists(select 1 from public.documents where id = p_document and org_id = p_org
      and library_kind = 'intake_attachment' and user_id = p_actor
      and project_id is null and workflow_id is null) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if exists(select 1 from public.intake_request_documents where document_id = p_document and request_id <> p_request) then
    raise exception 'The document belongs to another request' using errcode = '22023';
  end if;
  insert into public.intake_request_documents(org_id, request_id, document_id, added_by)
    values(p_org, p_request, p_document, p_actor) on conflict do nothing;
  if found then
    insert into public.intake_events(org_id, request_id, actor_id, kind)
      values(p_org, p_request, p_actor, 'document_added');
    update public.intake_requests set updated_at = now() where id = p_request;
  end if;
end $$;

create or replace function public.intake_list_documents(p_org uuid, p_actor uuid, p_request uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.organizations where id = p_org for share;
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'filename', coalesce(v.filename, 'Untitled document'),
      'file_type', v.file_type, 'size_bytes', v.size_bytes, 'status', d.status,
      'added_by_name', coalesce(u.display_name, u.email, 'Former member'), 'created_at', l.created_at)
      order by l.created_at, d.id), '[]')
    from public.intake_request_documents l
    join public.documents d on d.id = l.document_id
    left join public.document_versions v on v.id = d.current_version_id and v.deleted_at is null
    left join public.user_profiles u on u.user_id = l.added_by
    where l.org_id = p_org and l.request_id = p_request);
end $$;

-- Reading a private chat/review includes its referenced files, but only files
-- still in this organization. It does not grant access to a personal upload.
-- Every current member of the organization can read an intake attachment.
create or replace function public.org_private_document_access(p_org_id uuid,p_document_id uuid,p_user_id text)
returns boolean language sql stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.documents d where d.id=p_document_id and d.org_id=p_org_id
    and d.archived_at is null and (
      public.org_private_access_role(p_org_id,'document',d.id,p_user_id) is not null
      or exists(select 1 from public.org_private_content_access a
        join public.org_private_content_items(p_org_id) item on item.kind=a.kind and item.item_id=a.item_id
        join public.org_item_document_ids(a.kind,a.item_id) attached on attached.document_id=d.id
        where a.org_id=p_org_id and a.user_id::text=p_user_id
          and public.can_access_org_private_content(p_org_id,a.user_id))
      or (d.library_kind='intake_attachment' and exists(select 1 from public.intake_request_documents l
        where l.document_id=d.id and l.org_id=p_org_id)
        and public.intake_member_role(p_org_id,p_user_id::uuid) is not null)
    ));
$$;

-- A departing member's uploads stay with the request instead of being handed
-- over or archived as their private work.
create or replace function public.org_members_departure_items(p_org_id uuid,p_user_ids uuid[])
returns table(kind text,item_id uuid,title text,disposition text)
language sql stable set search_path = public as $$
  with roots as (
select 'project'::text kind,item.id item_id,
    case when item.visibility='organization' then item.name else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.projects item where item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'workflow'::text kind,item.id item_id,
    case when item.visibility='organization' then item.title else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.workflows item where item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'chat'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.chats item where item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'tabular_review'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.tabular_reviews item where item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
  ), documents as (
    select 'document'::text kind,d.id item_id,null::text title,
      case when exists (
        select 1 from public.chats c
        where c.org_id=p_org_id and c.archived_at is null
          and not exists(select 1 from public.projects p where p.id=c.project_id and p.archived_at is not null)
          and exists (select 1 from public.org_item_document_ids('chat',c.id) ref where ref.document_id=d.id)
          and not exists (select 1 from roots r where r.kind='chat' and r.item_id=c.id and r.disposition='archive')
          and (c.project_id is null or not exists (select 1 from roots r where r.kind='project' and r.item_id=c.project_id and r.disposition='archive'))
      ) or exists (
        select 1 from public.tabular_reviews tr
        where tr.org_id=p_org_id and tr.archived_at is null
          and not exists(select 1 from public.projects p where p.id=tr.project_id and p.archived_at is not null)
          and exists (select 1 from public.org_item_document_ids('tabular_review',tr.id) ref where ref.document_id=d.id)
          and not exists (select 1 from roots r where r.kind='tabular_review' and r.item_id=tr.id and r.disposition='archive')
          and (tr.project_id is null or not exists (select 1 from roots r where r.kind='project' and r.item_id=tr.project_id and r.disposition='archive'))
      ) then 'transfer' else 'archive' end disposition
    from public.documents d where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
      and d.library_kind <> 'intake_attachment'
  ) select * from roots union all select * from documents;
$$;

create or replace function public.org_private_content_items(p_org_id uuid)
returns table(kind text,item_id uuid,title text,user_id uuid) language sql stable set search_path=public,pg_temp as $$
  select 'project',id,name,user_id from public.projects
    where org_id=p_org_id and archived_at is null and visibility='private'
  union all select 'workflow',id,title,user_id from public.workflows
    where org_id=p_org_id and archived_at is null and visibility='private'
  union all select 'chat',id,title,user_id from public.chats
    where org_id=p_org_id and archived_at is null and project_id is null
  union all select 'tabular_review',id,title,user_id from public.tabular_reviews
    where org_id=p_org_id and archived_at is null and project_id is null
  union all select 'document',d.id,coalesce(v.filename,'Untitled document'),d.user_id
    from public.documents d left join public.document_versions v on v.id=d.current_version_id and v.deleted_at is null
    where d.org_id=p_org_id and d.archived_at is null and d.project_id is null and d.workflow_id is null
      and d.library_kind <> 'intake_attachment';
$$;

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
