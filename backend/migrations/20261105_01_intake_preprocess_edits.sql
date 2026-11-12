-- Migration date: 2026-11-05
-- Resolve/cancel and automatic document edits share the organization/request
-- locks. A close that commits first prevents the entire edit transaction; an
-- edit that wins is fully visible before a later close can capture documents.
create or replace function public.commit_intake_document_edits(
  p_org uuid, p_request uuid, p_request_version integer, p_document uuid,
  p_expected_version uuid, p_expected_path text, p_version jsonb, p_edits jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.intake_requests;
  d public.documents;
  v public.document_versions;
  saved jsonb;
  edits jsonb;
  v_version_id uuid := (p_version->>'id')::uuid;
begin
  perform 1 from public.organizations where id = p_org and deleted_at is null for update;
  if not found then return null; end if;
  select * into r from public.intake_requests where org_id = p_org and id = p_request for update;
  if not found then return null; end if;
  select * into d from public.documents where id = p_document for update;
  if not found or d.org_id is distinct from p_org or d.user_id is not null
    or d.library_kind is distinct from 'intake_attachment' or d.archived_at is not null
    or not exists(select 1 from public.intake_request_documents
      where org_id = p_org and request_id = p_request and document_id = p_document)
  then return null; end if;

  -- A lost response can follow a successful commit. Replaying that receipt
  -- never changes an active pointer, even if the request has since closed.
  select * into v from public.document_versions where id = v_version_id;
  if found then
    if v.document_id is distinct from p_document or v.deleted_at is not null
      or v.storage_path is distinct from p_version->>'storage_path'
      or v.source is distinct from 'assistant_edit'
    then raise exception 'version_identity_conflict' using errcode = '23505'; end if;
    saved := to_jsonb(v);
  else
    if r.state in ('resolved', 'cancelled') or r.version is distinct from p_request_version
      or d.current_version_id is distinct from p_expected_version
    then return null; end if;
    -- Direct version replacement need not lock the document parent. Hold the
    -- exact source row until activation so its checked bytes cannot change.
    select * into v from public.document_versions where id = p_expected_version
      and document_id = p_document and deleted_at is null for update;
    if not found or v.storage_path is distinct from p_expected_path
      or (select count(*) from public.document_versions where document_id = p_document and deleted_at is null) <> 1
    then return null; end if;
    if v_version_id is null or jsonb_typeof(p_edits) is distinct from 'array'
      or jsonb_array_length(p_edits) not between 1 and 500
      or p_version->>'source' is distinct from 'assistant_edit'
    then raise exception 'invalid_intake_edits' using errcode = '22023'; end if;
    saved := public.create_document_version(p_document, p_version, false);
    insert into public.document_edits(document_id, version_id, change_id, del_w_id, ins_w_id,
      deleted_text, inserted_text, context_before, context_after, status)
    select p_document, v_version_id, e->>'change_id', e->>'del_w_id', e->>'ins_w_id',
      coalesce(e->>'deleted_text', ''), coalesce(e->>'inserted_text', ''),
      e->>'context_before', e->>'context_after', 'pending'
    from jsonb_array_elements(p_edits) e;
    perform public.activate_document_version(p_document, v_version_id);
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
    into edits from public.document_edits e where e.document_id = p_document and e.version_id = v_version_id;
  return jsonb_build_object('version', saved, 'edits', edits);
end $$;
revoke all on function public.commit_intake_document_edits(uuid,uuid,integer,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_intake_document_edits(uuid,uuid,integer,uuid,uuid,text,jsonb,jsonb) to service_role;
