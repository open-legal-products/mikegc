-- Migration date: 2026-11-12
-- intake_claim_notifications (polled by every open tab) asks whether an event
-- exists for a message, and deleting an intake message cascades to its
-- events by the same column. Neither had an index to use, so both read every
-- organization's events.
create index if not exists intake_events_message
  on public.intake_events(message_id) where message_id is not null;
-- intake_dashboard reads each time one organization resolved a request; no
-- index on intake_events led with org_id.
create index if not exists intake_events_org_resolved
  on public.intake_events(org_id, created_at) where to_state = 'resolved' and request_id is not null;
