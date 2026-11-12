import type { Db } from "../../lib/supabase";

/**
 * An organization's automated intake settings as stored, read by the jobs
 * and channel adapters as well as the settings page. Secrets are encrypted
 * at rest (see intake.secrets.ts) and never returned to the browser.
 */
export type AutomationRow = {
  org_id: string;
  email_enabled: boolean;
  email_allowed_domains: string[] | null;
  /** The intake mailbox: Microsoft 365 through Graph, or Google Workspace. */
  email_provider: "graph" | "gmail" | null;
  email_mailbox: string | null;
  email_from_name: string | null;
  /** Names the organization in its Graph notification URL; not a credential. */
  email_webhook_id: string;
  email_last_read_at: string | null;
  email_error: string | null;
  graph_tenant_id: string | null;
  graph_client_id: string | null;
  graph_client_secret_encrypted: string | null;
  graph_client_secret_iv: string | null;
  graph_client_secret_tag: string | null;
  graph_subscription_id: string | null;
  graph_subscription_expires_at: string | null;
  graph_client_state_hash: string | null;
  graph_delta_link: string | null;
  gmail_history_id: string | null;
  /** The organization's own Gmail service account; else the deployment's. */
  gmail_service_account_key_encrypted: string | null;
  gmail_service_account_key_iv: string | null;
  gmail_service_account_key_tag: string | null;
  /** The client ID an admin delegates to; not a credential. */
  gmail_service_account_id: string | null;
  slack_enabled: boolean;
  slack_webhook_id: string;
  slack_team_id: string | null;
  slack_team_name: string | null;
  slack_bot_user_id: string | null;
  slack_signing_secret_encrypted: string | null;
  slack_signing_secret_iv: string | null;
  slack_signing_secret_tag: string | null;
  slack_bot_token_encrypted: string | null;
  slack_bot_token_iv: string | null;
  slack_bot_token_tag: string | null;
  /** The bot token's scopes from auth.test; null before they are known. */
  slack_scopes: string[] | null;
  slack_messages_seen_at: string | null;
  teams_enabled: boolean;
  teams_webhook_id: string;
  teams_app_id: string | null;
  teams_tenant_id: string | null;
  teams_client_secret_encrypted: string | null;
  teams_client_secret_iv: string | null;
  teams_client_secret_tag: string | null;
  /** Whether Graph can read and post documents for Teams; null before checked. */
  teams_files_access: boolean | null;
  /** The models triage and preprocessing run with; neither runs without one. */
  triage_model: string | null;
  preprocessing_model: string | null;
  configured_by: string | null;
};

export const AUTOMATION_COLUMNS =
  "org_id, email_enabled, email_allowed_domains, email_provider, email_mailbox, " +
  "email_from_name, email_webhook_id, email_last_read_at, email_error, " +
  "graph_tenant_id, graph_client_id, graph_client_secret_encrypted, graph_client_secret_iv, " +
  "graph_client_secret_tag, graph_subscription_id, graph_subscription_expires_at, " +
  "graph_client_state_hash, graph_delta_link, gmail_history_id, " +
  "gmail_service_account_key_encrypted, gmail_service_account_key_iv, " +
  "gmail_service_account_key_tag, gmail_service_account_id, " +
  "slack_enabled, slack_webhook_id, slack_team_id, slack_team_name, slack_bot_user_id, " +
  "slack_signing_secret_encrypted, slack_signing_secret_iv, slack_signing_secret_tag, " +
  "slack_bot_token_encrypted, slack_bot_token_iv, slack_bot_token_tag, slack_scopes, " +
  "slack_messages_seen_at, teams_enabled, teams_webhook_id, teams_app_id, teams_tenant_id, " +
  "teams_client_secret_encrypted, teams_client_secret_iv, teams_client_secret_tag, " +
  "teams_files_access, triage_model, preprocessing_model, configured_by";

/** The organization's settings, or null before anyone has opened them. */
export async function loadAutomationRow(
  db: Db,
  orgId: string,
): Promise<AutomationRow | null> {
  const { data, error } = await db
    .from("intake_automation")
    .select(AUTOMATION_COLUMNS)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as AutomationRow | null) ?? null;
}

/** The settings row that names a webhook, by one of its webhook ID columns. */
export async function automationByWebhook(
  db: Db,
  column: "slack_webhook_id" | "teams_webhook_id" | "email_webhook_id",
  webhookId: string,
): Promise<AutomationRow | null> {
  const { data, error } = await db
    .from("intake_automation")
    .select(AUTOMATION_COLUMNS)
    .eq(column, webhookId)
    .maybeSingle();
  if (error) throw error;
  return (data as AutomationRow | null) ?? null;
}
