-- Migration date: 2026-11-12
--
-- An organization's profile.
--
-- Owners and admins describe their organization: what it does, its industry,
-- where it is based and where it operates, the legal entities in its group,
-- its legal team, and anything else that helps. The assistant (chat and
-- project chat) and MikeGC's intake agent read it, with the organization's
-- name, as background for work in the organization's workspace.
--
--   org_profiles   the profile, one row per organization, none until set
--
-- The profile sits in a table of its own, not on organizations:
-- organizations are read with `select *` in many places, and none of them
-- need several kilobytes of prose. Every field is optional (null for none)
-- and bounded by a CHECK, because the whole profile is sent to the model with
-- every chat turn and every intake message.
--
-- Safe to re-run: create if not exists, idempotent revokes and grants.

create table if not exists public.org_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- What the organization does: its business, products or services, customers.
  about text
    constraint org_profiles_about_length check (char_length(about) <= 2000),
  industry text
    constraint org_profiles_industry_length check (char_length(industry) <= 200),
  headquarters text
    constraint org_profiles_headquarters_length
    check (char_length(headquarters) <= 200),
  -- Where it does business.
  jurisdictions text
    constraint org_profiles_jurisdictions_length
    check (char_length(jurisdictions) <= 500),
  -- The companies in its group, so the assistant can tell which party to a
  -- document is the organization.
  legal_entities text
    constraint org_profiles_legal_entities_length
    check (char_length(legal_entities) <= 1000),
  -- Who is in the legal team and what it covers.
  legal_team text
    constraint org_profiles_legal_team_length
    check (char_length(legal_team) <= 1000),
  -- Anything else: standard positions, preferred governing law, risk appetite.
  additional_context text
    constraint org_profiles_additional_context_length
    check (char_length(additional_context) <= 2000),
  -- Who changed it last. Provenance for the organization's admins; the
  -- profile outlives the account.
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.org_profiles enable row level security;

-- The backend reads and writes it as service_role; no client role may.
revoke all on public.org_profiles from anon, authenticated;
grant select, insert, update, delete on public.org_profiles to service_role;
