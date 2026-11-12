-- Migration date: 2026-11-12
-- Reconciles intake with the upstream Mike migrations merged on 2026-11-11.
-- Those migrations (20261030_03 … 20261101_21) redefine functions that
-- 20261026_00 and 20261030_03_intake_attachments had already changed, and a
-- database that ran the intake migrations first applies the upstream ones
-- afterwards, so the upstream definitions win. This restores the intake
-- behaviour on top of the upstream shapes; every definition below is the
-- upstream one plus the marked intake lines.

-- Upstream re-created the departure trigger function, which resets it to
-- SECURITY INVOKER. It reads auth.users, which GoTrue/service-role membership
-- deletion cannot (see 20261026_00).
alter function public.cleanup_removed_org_member_overrides() security definer;
alter function public.cleanup_removed_org_member_overrides()
  set search_path = pg_catalog, public, pg_temp;

-- An intake attachment belongs to its request, not to a member's private
-- work: it is not a private-content item (keyed lookup and paged catalogue,
-- matching org_private_content_items).
create or replace function public.org_private_content_item(p_org_id uuid,p_kind text,p_item_id uuid)
returns table(kind text,item_id uuid,title text,user_id uuid)
language sql stable set search_path=public,pg_temp as $$
  select 'project',p.id,p.name,p.user_id from public.projects p
    where p_kind='project' and p.id=p_item_id and p.org_id=p_org_id and p.archived_at is null and p.visibility='private'
  union all select 'workflow',w.id,w.title,w.user_id from public.workflows w
    where p_kind='workflow' and w.id=p_item_id and w.org_id=p_org_id and w.archived_at is null and w.visibility='private'
  union all select 'chat',c.id,c.title,c.user_id from public.chats c
    where p_kind='chat' and c.id=p_item_id and c.org_id=p_org_id and c.archived_at is null and c.project_id is null
  union all select 'tabular_review',r.id,r.title,r.user_id from public.tabular_reviews r
    where p_kind='tabular_review' and r.id=p_item_id and r.org_id=p_org_id and r.archived_at is null and r.project_id is null
  union all select 'document',d.id,coalesce(v.filename,'Untitled document'),d.user_id
    from public.documents d left join public.document_versions v on v.id=d.current_version_id and v.deleted_at is null
    where p_kind='document' and d.id=p_item_id and d.org_id=p_org_id and d.archived_at is null and d.project_id is null and d.workflow_id is null
      and d.library_kind <> 'intake_attachment';
$$;

create or replace function public.list_org_private_content(p_org_id uuid,p_actor_id uuid,p_limit integer default 50,p_offset integer default 0,p_search text default '')
returns table(kind text,item_id uuid,title text,user_id uuid,display_name text,email text,has_access boolean)
language plpgsql stable set search_path=public,pg_temp as $$
declare page_end bigint := greatest(0,p_offset)::bigint+greatest(1,least(p_limit,101));
begin
  if not public.can_access_org_private_content(p_org_id,p_actor_id) then
    raise exception 'Private content permission required' using errcode='42501';
  end if;
  -- The catalogue of org_private_content_items, one arm per kind. The page
  -- is ordered by (lower(title), kind, item_id) and kind is constant within
  -- an arm, so the page can only contain each arm's first offset+limit rows
  -- in (lower(title), id) order: each arm stops there (index order for
  -- projects, workflows, chats and reviews) and only those are sorted.
  return query select item.kind,item.item_id,item.title,item.user_id,profile.display_name,profile.email,
    exists(select 1 from public.org_private_content_access a where a.org_id=p_org_id and a.user_id=p_actor_id and a.kind=item.kind and a.item_id=item.item_id)
    from (
      select * from (select 'project'::text kind,p.id item_id,p.name title,p.user_id
        from public.projects p
        where p.org_id=p_org_id and p.archived_at is null and p.visibility='private' and p.user_id is distinct from p_actor_id
          and (p_search='' or position(lower(p_search) in lower(coalesce(p.name,'')))>0)
        order by lower(p.name) nulls last,p.id limit page_end) project_page
      union all
      select * from (select 'workflow'::text kind,w.id item_id,w.title title,w.user_id
        from public.workflows w
        where w.org_id=p_org_id and w.archived_at is null and w.visibility='private' and w.user_id is distinct from p_actor_id
          and (p_search='' or position(lower(p_search) in lower(coalesce(w.title,'')))>0)
        order by lower(w.title) nulls last,w.id limit page_end) workflow_page
      union all
      select * from (select 'chat'::text kind,c.id item_id,c.title title,c.user_id
        from public.chats c
        where c.org_id=p_org_id and c.archived_at is null and c.project_id is null and c.user_id is distinct from p_actor_id
          and (p_search='' or position(lower(p_search) in lower(coalesce(c.title,'')))>0)
        order by lower(c.title) nulls last,c.id limit page_end) chat_page
      union all
      select * from (select 'tabular_review'::text kind,r.id item_id,r.title title,r.user_id
        from public.tabular_reviews r
        where r.org_id=p_org_id and r.archived_at is null and r.project_id is null and r.user_id is distinct from p_actor_id
          and (p_search='' or position(lower(p_search) in lower(coalesce(r.title,'')))>0)
        order by lower(r.title) nulls last,r.id limit page_end) tabular_review_page
      union all
      select * from (select 'document'::text kind,d.id item_id,coalesce(v.filename,'Untitled document') title,d.user_id
        from public.documents d left join public.document_versions v on v.id=d.current_version_id and v.deleted_at is null
        where d.org_id=p_org_id and d.archived_at is null and d.project_id is null and d.workflow_id is null and d.user_id is distinct from p_actor_id
          and d.library_kind <> 'intake_attachment'
          and (p_search='' or position(lower(p_search) in lower(coalesce(coalesce(v.filename,'Untitled document'),'')))>0)
        order by lower(coalesce(v.filename,'Untitled document')) nulls last,d.id limit page_end) document_page
    ) item left join public.user_profiles profile on profile.user_id=item.user_id
    order by lower(item.title) nulls last,item.kind,item.item_id
    limit greatest(1,least(p_limit,101)) offset greatest(0,p_offset);
end;
$$;

-- Every current member of the organization can read an intake attachment.
create or replace function public.org_private_document_access(p_org_id uuid,p_document_id uuid,p_user_id text)
returns boolean language sql stable set search_path=public,pg_temp as $$
  -- Anchored on the document: the items that can carry it (its project or
  -- workflow, the chats/reviews referencing it and their projects) are
  -- looked up by key, then matched against the caller's opened items by
  -- primary key. Same answer as testing the document against every opened
  -- item's full org_item_document_ids list.
  select exists(select 1 from public.documents d where d.id=p_document_id and d.org_id=p_org_id
    and d.archived_at is null and (
      public.org_private_access_role(p_org_id,'document',d.id,p_user_id) is not null
      or exists(select 1 from (
          select 'project'::text kind,d.project_id item_id
          union all select 'workflow',d.workflow_id
          union all select ref.kind,ref.item_id from public.document_referencing_items(d.id) ref
          union all select 'project',ref.project_id from public.document_referencing_items(d.id) ref
        ) holder
        join public.org_private_content_access a on a.org_id=p_org_id
          and a.user_id=(case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)
          and a.kind=holder.kind and a.item_id=holder.item_id
        join public.org_private_content_item(p_org_id,a.kind,a.item_id) item on item.kind=a.kind and item.item_id=a.item_id
        where public.can_access_org_private_content(p_org_id,a.user_id))
      or (d.library_kind='intake_attachment' and exists(select 1 from public.intake_request_documents l
        where l.document_id=d.id and l.org_id=p_org_id)
        and public.intake_member_role(p_org_id,(case when p_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end)) is not null)
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
  from public.projects item where item.id in (
      -- Only items a departing member created or co-owns can be roots; the
      -- conditions below are evaluated for those, not every org project.
      -- Per departing member, a lookup by creator (user_id index); the
      -- organization is checked on the few rows found, never scanned.
      select p.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.projects own where own.user_id=leaver.id offset 0) p
        where p.org_id=p_org_id
      union select g.project_id from unnest(p_user_ids) leaver(id) join public.project_org_access_overrides g on g.user_id=leaver.id
        join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id
        where g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.project_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.project_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'workflow'::text kind,item.id item_id,
    case when item.visibility='organization' then item.title else null::text end title,
    case when (item.visibility='organization' or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.workflows item where item.id in (
      select w.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.workflows own where own.user_id=leaver.id offset 0) w
        where w.org_id=p_org_id
      union select g.workflow_id from unnest(p_user_ids) leaver(id) join public.workflow_org_access_overrides g on g.user_id=leaver.id
        join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id
        where g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null

    and (item.user_id=any(p_user_ids) or exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.workflow_org_access_overrides g join public.org_members holder on holder.user_id=g.user_id and holder.org_id=p_org_id where g.workflow_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'chat'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.chats item where item.id in (
      select c.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.chats own where own.user_id=leaver.id offset 0) c
        where c.org_id=p_org_id
      union select g.chat_id from unnest(p_user_ids) leaver(id) join public.user_profiles profile on profile.user_id=leaver.id
        join public.chat_access_grants g on g.email=lower(profile.email)
        join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id
        where profile.email is not null and btrim(profile.email)<>'' and g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.chat_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.chat_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
 union all
select 'tabular_review'::text kind,item.id item_id,
    null::text title,
    case when (exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role in ('owner','editor','viewer') and not (holder.user_id = any(p_user_ids)))) then 'transfer' else 'archive' end disposition
  from public.tabular_reviews item where item.id in (
      select r.id from unnest(p_user_ids) leaver(id)
        cross join lateral (select own.id,own.org_id from public.tabular_reviews own where own.user_id=leaver.id offset 0) r
        where r.org_id=p_org_id
      union select g.tabular_review_id from unnest(p_user_ids) leaver(id) join public.user_profiles profile on profile.user_id=leaver.id
        join public.tabular_review_access_grants g on g.email=lower(profile.email)
        join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id
        where profile.email is not null and btrim(profile.email)<>'' and g.role='owner')
    and item.org_id=p_org_id and item.archived_at is null
    and item.project_id is null
    and (item.user_id=any(p_user_ids) or exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and holder.user_id = any(p_user_ids)))
    and not exists (select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=item.user_id and not(m.user_id=any(p_user_ids)))
    and not exists (select 1 from public.tabular_review_access_grants g join public.user_profiles profile on lower(profile.email)=g.email and profile.email is not null and btrim(profile.email)<>'' join public.org_members holder on holder.user_id=profile.user_id and holder.org_id=p_org_id where g.tabular_review_id=item.id and g.role='owner' and not (holder.user_id = any(p_user_ids)))
  ), retained_documents as materialized (
    -- Start from the departing members' standalone documents (few) and look
    -- up who references each one, instead of expanding every chat message
    -- and review row in the organization. A reference counts when its chat
    -- or review is retained: live in this org, its project not archived, and
    -- neither it nor its project archived by this departure.
    select distinct d.id document_id
    from public.documents d
    cross join lateral public.document_referencing_items(d.id) ref
    left join public.chats c on ref.kind='chat' and c.id=ref.item_id
    left join public.tabular_reviews tr on ref.kind='tabular_review' and tr.id=ref.item_id
    where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
      and case ref.kind when 'chat' then c.org_id=p_org_id and c.archived_at is null
        else tr.org_id=p_org_id and tr.archived_at is null end
      and not exists(select 1 from public.projects p where p.id=ref.project_id and p.archived_at is not null)
      and not exists(select 1 from roots r where r.kind=ref.kind and r.item_id=ref.item_id and r.disposition='archive')
      and (ref.project_id is null or not exists(select 1 from roots r where r.kind='project' and r.item_id=ref.project_id and r.disposition='archive'))
  ), documents as (
    select 'document'::text kind,d.id item_id,null::text title,
      case when d.id in (select document_id from retained_documents) then 'transfer' else 'archive' end disposition
    from public.documents d where d.org_id=p_org_id and d.user_id=any(p_user_ids)
      and d.project_id is null and d.workflow_id is null and d.archived_at is null
      and d.library_kind <> 'intake_attachment'
  ) select * from roots union all select * from documents;
$$;
