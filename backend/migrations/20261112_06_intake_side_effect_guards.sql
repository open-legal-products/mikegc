-- Migration date: 2026-11-12
-- Suspension permanently stops pending sends; restoring an organization must
-- not unexpectedly send correspondence that was cancelled during deletion.
create or replace function public.intake_stop_deleted_org_deliveries()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.intake_outbound set status = 'failed',
      error = 'Delivery stopped because this workspace was deleted.'
      where org_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists intake_stop_deleted_org_deliveries on public.organizations;
create trigger intake_stop_deleted_org_deliveries after update of deleted_at on public.organizations
for each row execute function public.intake_stop_deleted_org_deliveries();
update public.intake_outbound o set status = 'failed',
  error = 'Delivery stopped because this workspace was deleted.'
where o.status = 'pending' and exists (
  select 1 from public.organizations g where g.id = o.org_id and g.deleted_at is not null);

-- The same locks used by request commands protect the complete version/edit
-- commit. A cancelled, resolved, replaced or unlinked request leaves no version.
create or replace function public.create_intake_document_edits(
  p_org uuid, p_request uuid, p_request_version integer, p_document uuid,
  p_expected_version uuid, p_version jsonb, p_edits jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r public.intake_requests; v jsonb; edits jsonb;
begin
  perform 1 from public.organizations where id = p_org and deleted_at is null for update;
  if not found then return null; end if;
  select * into r from public.intake_requests where id = p_request and org_id = p_org for update;
  if not found or r.state in ('resolved', 'cancelled') or p_request_version is null
      or r.version <> p_request_version then return null; end if;
  perform 1 from public.documents d where d.id = p_document and d.org_id = p_org
    and d.library_kind = 'intake_attachment' and d.current_version_id = p_expected_version
    and exists(select 1 from public.intake_request_documents a
      where a.org_id = p_org and a.request_id = p_request and a.document_id = d.id)
    for update;
  if not found then return null; end if;
  v := public.create_document_version(p_document, p_version, false);
  with inserted as (
    insert into public.document_edits(document_id, version_id, change_id, del_w_id, ins_w_id,
      deleted_text, inserted_text, context_before, context_after, status)
    select p_document, (v->>'id')::uuid, x.change_id, x.del_w_id, x.ins_w_id,
      coalesce(x.deleted_text, ''), coalesce(x.inserted_text, ''), x.context_before, x.context_after, 'pending'
    from jsonb_to_recordset(p_edits) as x(change_id text, del_w_id text, ins_w_id text,
      deleted_text text, inserted_text text, context_before text, context_after text)
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(inserted)), '[]') into edits from inserted;
  if not public.activate_document_version(p_document, (v->>'id')::uuid) then
    raise exception 'Document changed' using errcode = 'P0001';
  end if;
  return jsonb_build_object('version', v, 'edits', edits);
end $$;

-- A bounded status-only read; authorization remains identical to the detail page.
create or replace function public.intake_delivery_status(p_org uuid, p_actor uuid,
  p_request uuid, p_outbound uuid[])
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not public.intake_can_read(p_org, p_actor, p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if p_outbound is null or cardinality(p_outbound) > 100 then
    raise exception 'Invalid messages' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(public.intake_delivery(o) order by o.id)
    from public.intake_outbound o where o.org_id = p_org and o.request_id = p_request
      and o.id = any(p_outbound)), '[]'::jsonb);
end $$;
revoke all on function public.intake_stop_deleted_org_deliveries() from public, anon, authenticated;
revoke all on function public.create_intake_document_edits(uuid,uuid,integer,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.intake_delivery_status(uuid,uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.intake_stop_deleted_org_deliveries() to service_role;
grant execute on function public.create_intake_document_edits(uuid,uuid,integer,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.intake_delivery_status(uuid,uuid,uuid,uuid[]) to service_role;

-- An in-flight delivery cannot revive the cancelled outbox row after deletion.
create or replace function public.intake_record_delivery(p_org uuid, p_outbound uuid, p_status text,
  p_external_id text default null, p_error text default null, p_documents jsonb default null)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.organizations where id = p_org and deleted_at is null for update;
  if not found then return false; end if;
  if p_status is null or p_status not in ('pending', 'sent', 'failed')
    or (p_error is not null and char_length(p_error) > 200)
    or (p_documents is not null and (jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) > 10)) then
    raise exception 'Invalid delivery' using errcode = '22023';
  end if;
  update public.intake_outbound set status = p_status,
    external_id = coalesce(p_external_id, external_id),
    error = case when p_status = 'failed' then coalesce(p_error, 'MikeGC couldn''t send this message.') else null end,
    documents = coalesce(p_documents, documents),
    attempted_at = coalesce(attempted_at, now()),
    sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end
    where org_id = p_org and id = p_outbound and status = 'pending';
  return found;
end $$;

create or replace function public.intake_note_automated(p_org uuid, p_request uuid, p_note uuid, p_body text,
  p_purpose text default null)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.organizations where id = p_org and kind in ('team', 'personal')
    and deleted_at is null for update;
  if not found or not exists(select 1 from public.intake_requests where org_id = p_org and id = p_request) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  -- Serialize final preprocessing output with closure, just like its edits.
  perform 1 from public.intake_requests where id = p_request and org_id = p_org
    and (p_purpose is distinct from 'preprocessing' or state not in ('resolved', 'cancelled')) for update;
  if not found then return false; end if;
  if p_note is null or p_body is null or char_length(p_body) not between 1 and 20000 or btrim(p_body) = ''
    or (p_purpose is not null and p_purpose <> 'preprocessing') then
    raise exception 'Invalid note' using errcode = '22023';
  end if;
  if exists(select 1 from public.intake_messages where id = p_note) then return false; end if;
  insert into public.intake_messages(id, org_id, request_id, author_id, kind, body, automated, purpose)
    values(p_note, p_org, p_request, null, 'note', p_body, true, p_purpose);
  update public.intake_requests set updated_at = now() where id = p_request;
  return true;
end $$;
