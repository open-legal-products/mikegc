-- Migration date: 2026-11-12
--
-- An organization's profile.
--
-- Owners and admins describe their organization: what it does, its industry,
-- where it is headquartered and where it operates, the legal entities in its
-- group, the scope of its legal team, and anything else that helps. The
-- assistant (chat and project chat) and MikeGC's intake agent read it, with
-- the organization's name, as background for work in the organization's
-- workspace.
--
--   org_profiles   the profile, one row per organization, none until set
--
-- The profile sits in a table of its own, not on organizations:
-- organizations are read with `select *` in many places, and none of them
-- need several kilobytes of prose. Every field is optional (null, or an
-- empty list of jurisdictions, for none) and bounded by a CHECK, because the
-- whole profile is sent to the model with every chat turn and every intake
-- message.
--
-- Safe to re-run: create if not exists, idempotent revokes and grants.

create table if not exists public.org_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- What the organization does: its business, products or services, customers.
  about text
    constraint org_profiles_about_length check (char_length(about) <= 2000),
  industry text
    constraint org_profiles_industry_length check (char_length(industry) <= 200),
  -- Where it is headquartered; the country is picked from a list.
  headquarters_city text
    constraint org_profiles_headquarters_city_length
    check (char_length(headquarters_city) <= 100),
  headquarters_country text
    constraint org_profiles_headquarters_country_length
    check (char_length(headquarters_country) <= 100),
  -- Where it does business, picked from a list of countries and their states,
  -- provinces and legal systems. The backend holds each entry to 100
  -- characters; the list as a whole is bounded here.
  jurisdictions text[] not null default '{}'
    constraint org_profiles_jurisdictions_count
    check (cardinality(jurisdictions) <= 300),
  -- The companies in its group, so the assistant can tell which party to a
  -- document is the organization.
  legal_entities text
    constraint org_profiles_legal_entities_length
    check (char_length(legal_entities) <= 1000),
  -- What the legal team covers, and what goes elsewhere.
  legal_team_scope text
    constraint org_profiles_legal_team_scope_length
    check (char_length(legal_team_scope) <= 1000),
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
