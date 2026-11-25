-- Migration date: 2026-11-11

-- Postmark is gone entirely: no webhook, no Postmark mail left to process,
-- and no 'email' source. Email reaches intake only through the connected
-- Outlook or Gmail mailbox.

-- Requests recorded through Postmark name the organization's connected
-- mailbox instead, or read as typed by a member when none is connected.
update public.intake_requests r
   set source = case a.email_provider when 'graph' then 'outlook' when 'gmail' then 'gmail' else 'manual' end
  from public.intake_automation a
 where r.source = 'email' and a.org_id = r.org_id;
update public.intake_requests set source = 'manual' where source = 'email';

alter table public.intake_requests drop constraint if exists intake_requests_source_check;
alter table public.intake_requests add constraint intake_requests_source_check
  check (source in ('manual', 'slack', 'outlook', 'gmail', 'teams'));

-- Postmark mail still waiting can no longer be read; handled rows only kept
-- it from being stored twice, and Postmark delivers nothing now.
delete from public.intake_inbound where source = 'email';

alter table public.intake_inbound drop constraint if exists intake_inbound_source_check;
alter table public.intake_inbound add constraint intake_inbound_source_check
  check (source in ('slack', 'outlook', 'gmail', 'teams'));

-- Told an organization that used Postmark to connect its mailbox.
alter table public.intake_automation drop column if exists email_reconnect_notice;
