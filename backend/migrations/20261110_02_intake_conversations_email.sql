-- Migration date: 2026-11-10

-- Email converses like Slack and Teams: a message that isn't a request gets
-- an answer in its email thread, which is remembered here by provider.
alter table public.intake_conversations
  drop constraint if exists intake_conversations_source_check;
alter table public.intake_conversations
  add constraint intake_conversations_source_check
  check (source in ('slack', 'teams', 'gmail', 'outlook'));
