import type {
  IntakeAutomationSettings,
  IntakeMailboxConnection,
  IntakeMailProvider,
} from "@mike/contracts";

/**
 * The channels MikeGC records requests from, each set up in its own modal.
 * Outlook and Gmail are two ways to connect the one intake mailbox, so
 * connecting either replaces the other.
 */
export type IntakeChannelId = "outlook" | "gmail" | "slack" | "teams";

export const INTAKE_CHANNEL_NAMES: Record<IntakeChannelId, string> = {
  outlook: "Outlook",
  gmail: "Gmail",
  slack: "Slack",
  teams: "Teams",
};

/** The mail channels, by the provider their mailbox is on. */
export const INTAKE_MAIL_CHANNELS: Record<
  IntakeMailProvider,
  Extract<IntakeChannelId, "outlook" | "gmail">
> = {
  graph: "outlook",
  gmail: "gmail",
};

/** The provider a channel's mailbox is on, or null for a chat channel. */
export function intakeChannelMailProvider(
  channel: IntakeChannelId,
): IntakeMailProvider | null {
  return channel === "outlook" ? "graph" : channel === "gmail" ? "gmail" : null;
}

/** The mail systems an intake mailbox can be on, as Legal names them. */
export const INTAKE_MAIL_PROVIDER_LABELS: Record<IntakeMailProvider, string> = {
  graph: "Outlook (Microsoft 365)",
  gmail: "Gmail (Google Workspace)",
};

/**
 * A line on a channel's help screen: a short title, then what it means.
 * "{manifest}" in the text links to the channel's app manifest.
 */
export type IntakeHelpItem = { title: string; text: string };

/**
 * What each channel does, how to set it up in order, and what each of its
 * settings means, shown on its modal's help screen.
 */
export type IntakeChannelGuide = {
  overview: string;
  steps: IntakeHelpItem[];
  settings: IntakeHelpItem[];
};

const MAIL_OVERVIEW =
  "People email requests to an intake address, such as intake@company.com. MikeGC reads new mail there, records each request, and replies from the same address so answers stay in the thread.";

const MAIL_FINISH_STEPS: IntakeHelpItem[] = [
  {
    title: "Add sender domains",
    text: "The intake address's own domain is accepted from the start. Add the company's other sender domains.",
  },
  {
    title: "Test it",
    text: "Send a test email, then email a request to the intake address and check that it appears in Intake.",
  },
];

const MAIL_SETTINGS: IntakeHelpItem[] = [
  {
    title: "Sender name",
    text: 'MikeGC\'s own emails come from this name at the intake address. A lawyer\'s message reads "Their name via Legal".',
  },
  {
    title: "Allowed sender domains",
    text: "Mail counts only when its sender passes DMARC, SPF or DKIM for one of these domains. Mail from other domains is recorded as ignored.",
  },
];

const CHAT_OVERVIEW = (where: string) =>
  `People write @MikeGC in ${where} to send a message, or the thread it's in, to Legal. MikeGC asks for missing details, posts a lawyer's questions and replies with the resolution in the same thread.`;
/** The help for reusing the other Microsoft channel's Entra app. */
const SAME_APP_TEXT = (other: string) =>
  `Uses the Entra app ${other} is set up with, so its details aren't typed twice. MikeGC keeps its own copy of the client secret: changing it in ${other} later doesn't change it here. A separate app for each channel is safer, since a leaked secret then reaches only one.`;

export const INTAKE_CHANNEL_GUIDES: Record<IntakeChannelId, IntakeChannelGuide> =
  {
    outlook: {
      overview: MAIL_OVERVIEW,
      steps: [
        {
          title: "Register an Entra app",
          text: "In Microsoft Entra ID, register an app and create a client secret, or use the app Teams is set up with.",
        },
        {
          title: "Give it the intake mailbox only",
          text: "In Exchange Online PowerShell, assign the app the Application Mail.ReadWrite and Application Mail.Send roles with a management scope that holds only the intake mailbox (RBAC for Applications). Don't grant mail permissions in Entra ID: those cover every mailbox.",
        },
        {
          title: "Connect",
          text: "Enter the intake address and the app's tenant ID, client ID and client secret, or turn on Use the same app as Teams, then choose Connect.",
        },
        ...MAIL_FINISH_STEPS,
      ],
      settings: [
        {
          title: "Intake address",
          text: "A shared mailbox works best: it needs no licence and no one signs in to it.",
        },
        {
          title: "Tenant ID, client ID and client secret",
          text: "From the Entra app. The secret is write-only: once saved it is never shown.",
        },
        {
          title: "Use the same app as Teams",
          text: SAME_APP_TEXT("Teams"),
        },
        ...MAIL_SETTINGS,
      ],
    },
    gmail: {
      overview: MAIL_OVERVIEW,
      steps: [
        {
          title: "Create a service account",
          text: "In Google Cloud, enable the Gmail API in a project, create a service account and download its JSON key. Skip this to use this deployment's service account, if it has one.",
        },
        {
          title: "Delegate to it",
          text: "In the Google Admin console, under Security, API controls, Domain-wide delegation, add the service account client ID with the scope https://www.googleapis.com/auth/gmail.modify.",
        },
        {
          title: "Connect",
          text: "Enter the intake address, paste the JSON key and choose Connect.",
        },
        ...MAIL_FINISH_STEPS,
      ],
      settings: [
        {
          title: "Intake address",
          text: "A licensed Workspace user account. A Google Group can deliver into it, but can't be connected itself.",
        },
        {
          title: "Service account JSON key",
          text: "The key of the Google Cloud service account MikeGC reads and sends the intake mailbox's mail with. It is write-only: once saved it is never shown. Left empty, MikeGC uses this deployment's service account, if it has one.",
        },
        {
          title: "Service account client ID",
          text: "What to add under domain-wide delegation. It shows once a key is pasted or saved.",
        },
        ...MAIL_SETTINGS,
      ],
    },
    slack: {
      overview: CHAT_OVERVIEW("Slack"),
      steps: [
        {
          title: "Create the Slack app",
          text: "Create an app called MikeGC from {manifest} and install it to your workspace.",
        },
        {
          title: "Add its keys",
          text: "Paste the app's Signing Secret and Bot User OAuth Token here and save.",
        },
        {
          title: "Subscribe to events",
          text: "In Event Subscriptions, paste the Events Request URL and subscribe to the app_mention, message.channels and message.groups bot events.",
        },
        {
          title: "Invite MikeGC",
          text: "Invite @MikeGC to the channels people ask Legal in.",
        },
      ],
      settings: [
        {
          title: "Events Request URL",
          text: "Where Slack sends MikeGC the messages it is mentioned in.",
        },
        {
          title: "Signing Secret and Bot User OAuth Token",
          text: "From the app's Basic Information and OAuth & Permissions pages. Both are write-only: once saved they are never shown.",
        },
      ],
    },
    teams: {
      overview: CHAT_OVERVIEW("a Teams channel"),
      steps: [
        {
          title: "Register an Entra app",
          text: "In Microsoft Entra ID, register a single-tenant app and create a client secret.",
        },
        {
          title: "Create an Azure Bot",
          text: "Create a bot for that app ID, set its messaging endpoint to the Teams events URL, and turn on the Microsoft Teams channel.",
        },
        {
          title: "Install the Teams app",
          text: "Upload the package built from the manifest in the setup guide to your app catalog, then add it to the teams that ask Legal. A team owner consents to it reading channel messages.",
        },
        {
          title: "Allow documents (optional)",
          text: "Grant the app Microsoft Graph Sites.Selected for those teams' sites, or Files.ReadWrite.All, with admin consent.",
        },
        {
          title: "Add its keys",
          text: "Enter the app ID, tenant ID and client secret here, or turn on Use the same app as Outlook, then save.",
        },
      ],
      settings: [
        {
          title: "Teams events URL",
          text: "The Azure Bot's messaging endpoint, where Teams sends MikeGC the messages it is mentioned in.",
        },
        {
          title: "Use the same app as Outlook",
          text: SAME_APP_TEXT("Outlook"),
        },
        {
          title: "Document access",
          text: "With Microsoft Graph access to files, MikeGC reads files shared in threads and posts documents to the channel's files. Without it, MikeGC posts text only and names the documents.",
        },
      ],
    },
  };

/**
 * Where a channel's tile stands: set up (it shows its on/off switch, and
 * opens its modal) or not (it shows Set up), and whether it is on. What
 * needs attention is said in the channel's modal.
 */
export type IntakeChannelSummary = { configured: boolean; enabled: boolean };

export function intakeChannelSummary(
  settings: IntakeAutomationSettings,
  channel: IntakeChannelId,
): IntakeChannelSummary {
  const provider = intakeChannelMailProvider(channel);
  const { configured, enabled } = provider
    ? {
        configured: settings.email.provider === provider,
        enabled: settings.email.enabled,
      }
    : settings[channel as "slack" | "teams"];
  return { configured, enabled: configured && enabled };
}

/** What the connect form holds; the secret and the JSON key are write-only. */
export type IntakeMailboxForm = {
  provider: IntakeMailProvider;
  mailbox: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /**
   * Outlook: connect with the Teams channel's Entra app instead of the IDs
   * and secret above, which are then not sent.
   */
  useTeamsApp: boolean;
  /** Gmail: the service account's JSON key, as Google Cloud downloads it. */
  serviceAccountKey: string;
};

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The connect form for `provider`, starting from what is saved. A first
 * Outlook connection starts with the Teams app when Teams is set up, so the
 * same app isn't typed twice; reconnecting keeps the saved details.
 */
export function intakeMailboxForm(
  provider: IntakeMailProvider,
  email: IntakeAutomationSettings["email"],
  teamsConfigured = false,
): IntakeMailboxForm {
  const same = email.provider === provider;
  return {
    provider,
    mailbox: same ? (email.mailbox ?? "") : "",
    tenantId: same ? (email.graph.tenant_id ?? "") : "",
    clientId: same ? (email.graph.client_id ?? "") : "",
    clientSecret: "",
    useTeamsApp: provider === "graph" && !same && teamsConfigured,
    serviceAccountKey: "",
  };
}

/**
 * The connected Outlook mailbox's Entra app, which Teams can be set up with,
 * or null while Outlook isn't connected with all of it.
 */
export function intakeOutlookApp(
  email: IntakeAutomationSettings["email"],
): { tenantId: string; clientId: string } | null {
  const { tenant_id, client_id, secret_set } = email.graph;
  return email.provider === "graph" && tenant_id && client_id && secret_set
    ? { tenantId: tenant_id, clientId: client_id }
    : null;
}

/**
 * A pasted service account key's client ID, the numeric one Google Admin
 * delegates to: null when nothing is pasted, false when what is pasted isn't
 * such a key as Google Cloud downloads it (with that ID).
 */
export function intakeServiceAccountClientId(raw: string): string | null | false {
  const text = raw.trim();
  if (!text) return null;
  try {
    const key = JSON.parse(text) as Record<string, unknown>;
    if (key.type !== undefined && key.type !== "service_account") return false;
    if (typeof key.client_email !== "string" || !key.client_email.includes("@"))
      return false;
    if (typeof key.private_key !== "string" || !key.private_key.includes("PRIVATE KEY"))
      return false;
    return typeof key.client_id === "string" && /^\d{1,64}$/.test(key.client_id)
      ? key.client_id
      : false;
  } catch {
    return false;
  }
}

/** Whether Gmail can connect without a key: one is saved, or the deployment's. */
export const intakeGmailKeyOptional = (email: IntakeAutomationSettings["email"]) =>
  email.gmail.key_set || email.gmail.deployment_key;

/**
 * Why the connect form can't be sent yet, or null when it can. `secretSaved`
 * is whether the provider's secret may be left empty: Outlook's client
 * secret is saved, or Gmail has a saved or deployment key.
 */
export function intakeMailboxFormProblem(
  form: IntakeMailboxForm,
  secretSaved: boolean,
): string | null {
  if (!EMAIL_SHAPE.test(form.mailbox.trim()))
    return "Enter the intake address, such as intake@company.com.";
  if (form.provider === "gmail") {
    const clientId = intakeServiceAccountClientId(form.serviceAccountKey);
    if (clientId === false)
      return "Paste the service account's JSON key as Google Cloud downloads it.";
    if (clientId === null && !secretSaved)
      return "Paste the service account's JSON key.";
    return null;
  }
  if (form.useTeamsApp) return null;
  if (!form.tenantId.trim()) return "Enter the Microsoft 365 tenant ID.";
  if (!form.clientId.trim()) return "Enter the Entra app's client ID.";
  if (!form.clientSecret.trim() && !secretSaved)
    return "Enter the Entra app's client secret.";
  return null;
}

/** The connection as the API takes it; an empty secret keeps the saved one. */
export function intakeMailboxConnection(
  form: IntakeMailboxForm,
): IntakeMailboxConnection {
  const mailbox = form.mailbox.trim();
  if (form.provider === "gmail") {
    const key = form.serviceAccountKey.trim();
    return { provider: "gmail", mailbox, ...(key ? { service_account_key: key } : {}) };
  }
  if (form.useTeamsApp) return { provider: "graph", mailbox, use_teams_app: true };
  const secret = form.clientSecret.trim();
  return {
    provider: "graph",
    mailbox,
    tenant_id: form.tenantId.trim(),
    client_id: form.clientId.trim(),
    ...(secret ? { client_secret: secret } : {}),
  };
}
