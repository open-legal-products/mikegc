"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Image from "next/image";
import {
  CircleHelp,
  Loader2,
  Pencil,
  Send,
  Unplug,
  X,
} from "lucide-react";
import { HeaderActionsMenu } from "@/app/components/shared/HeaderActionsMenu";
import type {
  IntakeAutomationSettings,
  IntakeAutomationUpdate,
  IntakeMailProvider,
} from "@mike/contracts";
import { Modal } from "@/app/components/modals/Modal";
import { ConnectorCard } from "@/app/components/settings/ConnectorCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { SlackLogo } from "@/app/components/settings/SlackLogo";
import {
  connectIntakeMailbox,
  disconnectIntakeMailbox,
  sendIntakeMailboxTest,
  updateIntakeAutomation,
} from "@/app/lib/mikeApi";
import { useAssignLatest } from "@/app/hooks/useLatestRef";
import { notifyError } from "@/app/lib/userFacingError";
import { notifySuccess } from "@mike/client";
import { GlassCardUI } from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { TextButtonUI } from "@mike/ui";
import { ToggleSwitchUI } from "@mike/ui";
import { slackIntakeManifest } from "./slackManifest";
import {
  intakeAutomationChanges,
  intakeAutomationDraft,
  intakeDomainInputError,
  normalizeIntakeDomain,
  type IntakeAutomationDraft,
} from "./intakeAutomation";
import {
  INTAKE_CHANNEL_GUIDES,
  INTAKE_CHANNEL_NAMES,
  INTAKE_MAIL_CHANNELS,
  intakeChannelMailProvider,
  intakeChannelSummary,
  intakeGmailKeyOptional,
  intakeMailboxConnection,
  intakeMailboxForm,
  intakeMailboxFormProblem,
  intakeOutlookApp,
  intakeServiceAccountClientId,
  type IntakeChannelGuide,
  type IntakeChannelId,
  type IntakeChannelSummary,
  type IntakeMailboxForm,
} from "./intakeChannels";
import {
  CopyValue,
  ERROR_CLASS,
  LABEL_CLASS,
  ROW_DESCRIPTION_CLASS,
  ROW_LABEL_CLASS,
  SecretField,
  SettingsNotice,
  TextField,
  ToggleRow,
} from "./IntakeSettingsFields";

const CHANNELS: IntakeChannelId[] = ["outlook", "gmail", "slack", "teams"];

/** A product logo served from public/icons/integrations. */
function IntegrationLogo({ file }: { file: string }) {
  return (
    <Image
      src={`/icons/integrations/${file}`}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      unoptimized
      className="h-5 w-5 object-contain"
    />
  );
}

const CHANNEL_ICONS: Record<IntakeChannelId, ReactNode> = {
  outlook: <IntegrationLogo file="outlook.svg" />,
  gmail: <IntegrationLogo file="gmail.png" />,
  slack: <SlackLogo />,
  teams: <IntegrationLogo file="teams.svg" />,
};

/** The field each tile's switch saves. */
const ENABLED_FIELD: Record<IntakeChannelId, keyof IntakeAutomationUpdate> = {
  outlook: "email_enabled",
  gmail: "email_enabled",
  slack: "slack_enabled",
  teams: "teams_enabled",
};

type Change = (patch: Partial<IntakeAutomationDraft>) => void;

/**
 * The channels MikeGC records requests from, as connector tiles: each names
 * the channel with its logo. A channel that is set up shows its on/off
 * switch, which saves at once, and the tile opens its modal; one that isn't
 * shows Set up. Everything else, from its keys to its sender domains, is in
 * the modal, which saves with its own button; closing it discards what
 * wasn't saved.
 */
export function IntakeChannelsSection({
  orgId,
  settings,
  onSettings,
}: {
  orgId: string;
  settings: IntakeAutomationSettings;
  /** What the server has after a modal saved, connected or disconnected. */
  onSettings: (settings: IntakeAutomationSettings) => void;
}) {
  const heading = useId();
  const [open, setOpen] = useState<IntakeChannelId | null>(null);
  // The switch whose change is saving; the others wait for it.
  const [switching, setSwitching] = useState<IntakeChannelId | null>(null);

  function setEnabled(channel: IntakeChannelId, enabled: boolean) {
    setSwitching(channel);
    updateIntakeAutomation(orgId, { [ENABLED_FIELD[channel]]: enabled }).then(
      (next) => {
        setSwitching(null);
        onSettings(next);
      },
      (cause) => {
        setSwitching(null);
        notifyError(cause, {
          action: `turn ${INTAKE_CHANNEL_NAMES[channel]} ${enabled ? "on" : "off"}`,
          onRetry: () => setEnabled(channel, enabled),
        });
      },
    );
  }

  return (
    <section aria-labelledby={heading} className="space-y-3">
      <SettingsHeading id={heading}>Channels</SettingsHeading>
      {/* Laid out like the connector lists: two tiles a row once there's room. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
          {CHANNELS.map((channel) => (
            <IntakeChannelCard
              key={channel}
              channel={channel}
              summary={intakeChannelSummary(settings, channel)}
              busy={switching !== null}
              onOpen={() => setOpen(channel)}
              onEnabledChange={(enabled) => setEnabled(channel, enabled)}
            />
          ))}
        </div>
      </div>
      {/* Mounted only while open, so closing drops what wasn't saved and
          returns focus to the card's button. */}
      {open && (
        <IntakeChannelModal
          key={open}
          channel={open}
          orgId={orgId}
          settings={settings}
          onSettings={onSettings}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/**
 * One channel's tile, styled like a connector's: its logo and name, then its
 * on/off switch once it is set up (the tile opens its modal) or a Set up
 * button before.
 */
export function IntakeChannelCard({
  channel,
  summary,
  busy,
  onOpen,
  onEnabledChange,
}: {
  channel: IntakeChannelId;
  summary: IntakeChannelSummary;
  /** A switch is saving: every switch waits. */
  busy: boolean;
  onOpen: () => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const name = INTAKE_CHANNEL_NAMES[channel];
  return (
    <ConnectorCard
      name={name}
      kind="channel"
      icon={CHANNEL_ICONS[channel]}
      onOpen={summary.configured ? onOpen : undefined}
      action={
        summary.configured ? (
          <ToggleSwitchUI
            checked={summary.enabled}
            disabled={busy}
            aria-busy={busy}
            aria-label={`${name} channel`}
            onCheckedChange={onEnabledChange}
          />
        ) : (
          <PillButtonUI
            tone="blue"
            size="sm"
            // The visible word starts the name, which says which channel.
            aria-label={`Set up ${name}`}
            aria-haspopup="dialog"
            onClick={onOpen}
          >
            Set up
          </PillButtonUI>
        )
      }
    />
  );
}

/** The fields a channel's modal may change; nothing else is ever sent. */
const EMAIL_FIELDS: (keyof IntakeAutomationUpdate)[] = [
  "email_enabled",
  "email_allowed_domains",
  "email_from_name",
];
const CHANNEL_FIELDS: Record<IntakeChannelId, (keyof IntakeAutomationUpdate)[]> =
  {
    outlook: EMAIL_FIELDS,
    gmail: EMAIL_FIELDS,
    slack: ["slack_enabled", "slack_signing_secret", "slack_bot_token"],
    teams: [
      "teams_enabled",
      "teams_app_id",
      "teams_tenant_id",
      "teams_client_secret",
    ],
  };

/**
 * What saving a channel's modal sends: its fields that differ from what is
 * saved. A sender domain typed but not yet added goes too, when it is one.
 * Slack and Teams show their switch only once set up, so the save that
 * completes one's setup turns it on. With `useOutlookApp`, Teams is set up
 * with the connected Outlook mailbox's app instead of typed details.
 */
export function intakeChannelChanges(
  channel: IntakeChannelId,
  settings: IntakeAutomationSettings,
  draft: IntakeAutomationDraft,
  { useOutlookApp = false }: { useOutlookApp?: boolean } = {},
): IntakeAutomationUpdate {
  if (channel === "teams" && useOutlookApp) {
    const changes: IntakeAutomationUpdate = { teams_use_outlook_app: true };
    if (settings.teams.configured && draft.teamsEnabled !== settings.teams.enabled)
      changes.teams_enabled = draft.teamsEnabled;
    if (!settings.teams.configured) changes.teams_enabled = true;
    return changes;
  }
  const typed = normalizeIntakeDomain(draft.domainInput);
  const withTyped =
    typed && !intakeDomainInputError(draft) && !draft.domains.includes(typed)
      ? { ...draft, domains: [...draft.domains, typed] }
      : draft;
  const all = intakeAutomationChanges(settings, withTyped);
  const changes: IntakeAutomationUpdate = {};
  for (const key of CHANNEL_FIELDS[channel])
    if (all[key] !== undefined)
      Object.assign(changes, { [key]: all[key] });
  const completes =
    channel === "slack"
      ? !settings.slack.configured &&
        !!changes.slack_signing_secret &&
        !!changes.slack_bot_token
      : channel === "teams" &&
        !settings.teams.configured &&
        !!(changes.teams_app_id ?? settings.teams.app_id) &&
        !!(changes.teams_tenant_id ?? settings.teams.tenant_id) &&
        !!changes.teams_client_secret;
  if (completes) Object.assign(changes, { [ENABLED_FIELD[channel]]: true });
  return changes;
}

/**
 * A channel's modal: everything about it, saved by the footer's button. An
 * Outlook or Gmail modal first connects the intake mailbox on that provider;
 * once it is connected there it manages it.
 */
function IntakeChannelModal({
  channel,
  orgId,
  settings,
  onSettings,
  onClose,
}: {
  channel: IntakeChannelId;
  orgId: string;
  settings: IntakeAutomationSettings;
  onSettings: (settings: IntakeAutomationSettings) => void;
  onClose: () => void;
}) {
  const name = INTAKE_CHANNEL_NAMES[channel];
  const guide = INTAKE_CHANNEL_GUIDES[channel];
  const provider = intakeChannelMailProvider(channel);
  const [draft, setDraft] = useState(() => intakeAutomationDraft(settings));
  // The help screen replaces the fields until Back; what was typed is kept.
  const [helping, setHelping] = useState(false);
  // Slack's manifest, opened from its help screen's setup step.
  const [showingManifest, setShowingManifest] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const helpScreen = useRef<HTMLDivElement>(null);
  const manifestLink = useRef<HTMLButtonElement>(null);
  const viewed = useRef<{ helping: boolean; manifest: boolean } | null>(null);
  useEffect(() => {
    // Focus follows each screen: onto the help screen or the manifest, and
    // back to what opened it.
    const before = viewed.current;
    viewed.current = { helping, manifest: showingManifest };
    if (!before) return;
    if (showingManifest || (helping && !before.manifest))
      helpScreen.current?.focus();
    else if (helping) manifestLink.current?.focus();
    else helpButton.current?.focus();
  }, [helping, showingManifest]);
  const [saving, setSaving] = useState(false);
  // A mail modal's connect form, while it is open: from the start until the
  // mailbox is connected on this provider, and while reconnecting.
  const [form, setForm] = useState<IntakeMailboxForm | null>(() =>
    provider && settings.email.provider !== provider
      ? intakeMailboxForm(provider, settings.email, settings.teams.configured)
      : null,
  );
  // Teams set up with the connected Outlook mailbox's app; starts on for a
  // first setup when there is one. Kept here, not in the draft, so only this
  // modal's Save ever sends it.
  const outlookApp = intakeOutlookApp(settings.email);
  const [useOutlookApp, setUseOutlookApp] = useState(
    () => channel === "teams" && !settings.teams.configured && !!outlookApp,
  );
  const change: Change = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const pending = intakeChannelChanges(channel, settings, draft, {
    useOutlookApp: useOutlookApp && !!outlookApp,
  });
  const dirty = Object.keys(pending).length > 0;
  const connecting = !!form;
  // Editing a live connection: Back returns to its settings.
  const editingConnection =
    connecting && !!provider && settings.email.provider === provider;

  // Retry runs this render's save or connect while the modal is open.
  const latest = useRef<{ save: () => void; connect: () => void } | null>(
    null,
  );
  useEffect(
    () => () => {
      latest.current = null;
    },
    [],
  );
  /**
   * Every refused save or connect is a notice, never footer text: what
   * Microsoft, Google or Slack said ("Microsoft couldn't find that mailbox")
   * and Retry when retrying can help. The modal stays open with what was
   * typed, to fix it. Retry once the modal is closed sends again only what
   * failed. Repeats of one action collapse into one notice.
   */
  function failed(
    cause: unknown,
    action: string,
    which: "save" | "connect",
    resend: () => Promise<IntakeAutomationSettings>,
    done: string,
  ) {
    setSaving(false);
    const dedupeKey = `intake-channel:${orgId}:${channel}:${which}`;
    const retry = () => {
      if (latest.current) return latest.current[which]();
      resend().then(
        (next) => {
          onSettings(next);
          notifySuccess(done);
        },
        (again) => notifyError(again, { action, onRetry: retry, dedupeKey }),
      );
    };
    notifyError(cause, { action, onRetry: retry, dedupeKey });
  }
  function save() {
    // A sender domain still being typed must be one before anything is sent.
    if (!dirty || saving || intakeDomainInputError(draft)) return;
    setSaving(true);
    const changes = pending;
    const done = `${name} settings saved`;
    updateIntakeAutomation(orgId, changes).then(
      (next) => {
        onSettings(next);
        notifySuccess(done);
        onClose();
      },
      (cause) =>
        failed(
          cause,
          `save the ${name} settings`,
          "save",
          () => updateIntakeAutomation(orgId, changes),
          done,
        ),
    );
  }
  function connect() {
    if (!form || saving) return;
    setSaving(true);
    const connection = intakeMailboxConnection(form);
    connectIntakeMailbox(orgId, connection).then(
      (next) => {
        onSettings(next);
        // The modal stays open to finish the setup: domains, name, a test.
        setDraft(intakeAutomationDraft(next));
        setForm(null);
        setSaving(false);
        notifySuccess(`Connected ${next.email.mailbox ?? "the mailbox"}`);
      },
      (cause) =>
        failed(
          cause,
          "connect the mailbox",
          "connect",
          () => connectIntakeMailbox(orgId, connection),
          `Connected ${connection.mailbox}`,
        ),
    );
  }
  useAssignLatest(latest, { save, connect });

  const secretSaved =
    form?.provider === "gmail"
      ? intakeGmailKeyOptional(settings.email)
      : settings.email.provider === "graph" && settings.email.graph.secret_set;
  const formProblem = form ? intakeMailboxFormProblem(form, secretSaved) : null;
  const spinner = saving ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : undefined;
  // Back, at the footer's left: from the manifest or help screen, or from
  // editing a live connection to its settings.
  const backAction = showingManifest
    ? { label: "Back", onClick: () => setShowingManifest(false) }
    : helping
      ? { label: "Back", onClick: () => setHelping(false) }
      : editingConnection
        ? { label: "Back", onClick: () => setForm(null), disabled: saving }
        : undefined;
  const primaryAction = helping
    ? undefined
    : connecting
      ? {
          label: "Connect",
          icon: spinner,
          onClick: connect,
          disabled: saving || !!formProblem,
          title: formProblem ?? undefined,
        }
      : {
          label: "Save",
          icon: spinner,
          onClick: save,
          disabled: saving || !dirty || !!intakeDomainInputError(draft),
        };

  return (
    <Modal
      open
      size="md"
      onClose={() => !saving && onClose()}
      // Where it belongs, then the channel, which names the dialog.
      breadcrumbs={[
        "Intake",
        "Channels",
        name,
        ...(editingConnection ? ["Edit connection"] : []),
        ...(helping ? ["Help"] : []),
        ...(showingManifest ? ["Manifest"] : []),
      ]}
      backAction={backAction}
      primaryAction={primaryAction}
      // Closing discards what wasn't saved; the header's Close does the same.
      cancelAction={
        helping || editingConnection
          ? false
          : { label: "Cancel", onClick: onClose, disabled: saving }
      }
    >
      {helping ? (
        <div
          ref={helpScreen}
          tabIndex={-1}
          data-modal-scroll="vertical"
          className="min-h-0 flex-1 overflow-y-auto pb-5 focus:outline-none"
        >
          {showingManifest ? (
            <SlackManifest eventsUrl={settings.slack.events_url} />
          ) : (
            <ChannelHelp
              guide={guide}
              manifestLink={manifestLink}
              onManifest={
                channel === "slack" ? () => setShowingManifest(true) : undefined
              }
            />
          )}
        </div>
      ) : (
        <div
          data-modal-scroll="vertical"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-5"
        >
          {provider ? (
            <IntakeEmailFields
              orgId={orgId}
              provider={provider}
              settings={settings.email}
              teams={settings.teams}
              draft={draft}
              form={form}
              busy={saving}
              onChange={change}
              onForm={setForm}
              onSave={save}
              onSettings={(next) => {
                onSettings(next);
                setDraft(intakeAutomationDraft(next));
              }}
            />
          ) : channel === "slack" ? (
            <IntakeSlackFields
              settings={settings.slack}
              draft={draft}
              onChange={change}
              onSave={save}
            />
          ) : (
            <IntakeTeamsFields
              settings={settings.teams}
              draft={draft}
              outlookApp={outlookApp}
              useOutlookApp={useOutlookApp && !!outlookApp}
              busy={saving}
              onUseOutlookApp={setUseOutlookApp}
              onChange={change}
              onSave={save}
            />
          )}
          {/* Where the connection is entered: a mailbox's connect form;
              Slack's and Teams' keys are on their main screen. */}
          {(!provider || connecting) && (
            <TextButtonUI
              ref={helpButton}
              size="xs"
              className="gap-1 px-0"
              aria-label={`${name} help`}
              onClick={() => setHelping(true)}
            >
              <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
              Setup help
            </TextButtonUI>
          )}
        </div>
        )}
    </Modal>
  );
}

/**
 * A channel's help screen: what it does, how to set it up in numbered steps,
 * and what each of its settings means.
 */
function ChannelHelp({
  guide,
  manifestLink,
  onManifest,
}: {
  guide: IntakeChannelGuide;
  manifestLink: RefObject<HTMLButtonElement | null>;
  /** Opens the app manifest a step's "{manifest}" links to. */
  onManifest?: () => void;
}) {
  const stepsHeading = useId();
  const settingsHeading = useId();
  const overviewHeading = useId();
  return (
    <div className="space-y-6">
      <section aria-labelledby={overviewHeading} className="space-y-2">
        <h3 id={overviewHeading} className={ROW_LABEL_CLASS}>
          What it does
        </h3>
        <p className="text-sm text-gray-700">{guide.overview}</p>
      </section>
      <section aria-labelledby={stepsHeading} className="space-y-3">
        <h3 id={stepsHeading} className={ROW_LABEL_CLASS}>
          How to set it up
        </h3>
        <ol className="space-y-3">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="flex min-w-0 gap-3">
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-medium text-gray-600"
              >
                {index + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-gray-900">{step.title}</p>
                <p className="text-sm text-gray-600 [overflow-wrap:anywhere]">
                  {onManifest ? (
                    <StepText
                      text={step.text}
                      linkRef={manifestLink}
                      onManifest={onManifest}
                    />
                  ) : (
                    step.text.replace("{manifest}", "the manifest in the setup guide")
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby={settingsHeading} className="space-y-3">
        <h3 id={settingsHeading} className={ROW_LABEL_CLASS}>
          What each setting means
        </h3>
        <GlassCardUI>
          <dl className="divide-y divide-gray-100">
            {guide.settings.map((setting) => (
              <div key={setting.title} className="space-y-0.5 px-4 py-3">
                <dt className="text-sm font-medium text-gray-900">
                  {setting.title}
                </dt>
                <dd className="text-sm text-gray-600 [overflow-wrap:anywhere]">
                  {setting.text}
                </dd>
              </div>
            ))}
          </dl>
        </GlassCardUI>
      </section>
    </div>
  );
}

/** A step's text, its "{manifest}" a link that opens the manifest. */
function StepText({
  text,
  linkRef,
  onManifest,
}: {
  text: string;
  linkRef: RefObject<HTMLButtonElement | null>;
  onManifest: () => void;
}) {
  const [before, after] = text.split("{manifest}");
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <TextButtonUI
        ref={linkRef}
        size="xs"
        className="inline h-auto px-0 align-baseline text-sm text-blue-600 underline hover:text-blue-700"
        onClick={onManifest}
      >
        the manifest
      </TextButtonUI>
      {after}
    </>
  );
}

/**
 * The Slack app's manifest, with the organization's Events Request URL, to
 * paste into Slack's "Create an app" from a manifest.
 */
function SlackManifest({ eventsUrl }: { eventsUrl: string }) {
  return (
    <div className="space-y-4">
      <p className={ROW_DESCRIPTION_CLASS}>
        In Slack, choose Create New App, then From a manifest, pick your
        workspace and paste this. It already has this workspace&apos;s Events
        Request URL.
      </p>
      <CopyValue
        label="Slack app manifest"
        name="Slack app manifest"
        value={slackIntakeManifest(eventsUrl)}
        multiline
      />
    </div>
  );
}

/**
 * Outlook or Gmail: connect the intake mailbox on `provider` (Microsoft 365
 * through an Entra app, or Google Workspace through the deployment's service
 * account), then manage it: the switch, its address and how reading it is
 * going, a test email, reconnecting or disconnecting, the sender name and
 * the sender domains.
 */
function IntakeEmailFields({
  orgId,
  provider,
  settings,
  teams,
  draft,
  form,
  busy,
  onChange,
  onForm,
  onSave,
  onSettings,
}: {
  orgId: string;
  /** The channel's provider; the mailbox may be connected on the other. */
  provider: IntakeMailProvider;
  settings: IntakeAutomationSettings["email"];
  /** Teams, whose Entra app Outlook can connect with. */
  teams: IntakeAutomationSettings["teams"];
  draft: IntakeAutomationDraft;
  form: IntakeMailboxForm | null;
  /** Saving or connecting: the fields wait. */
  busy: boolean;
  onChange: Change;
  onForm: (form: IntakeMailboxForm | null) => void;
  onSave: () => void;
  onSettings: (settings: IntakeAutomationSettings) => void;
}) {
  const connected = settings.provider === provider;
  const [testing, setTesting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function disconnect() {
    setConfirmingDisconnect(false);
    setDisconnecting(true);
    disconnectIntakeMailbox(orgId).then(
      (next) => {
        setDisconnecting(false);
        onSettings(next);
        // The modal stays open on the connect form, to connect again.
        onForm(intakeMailboxForm(provider, next.email, next.teams.configured));
      },
      (cause) => {
        setDisconnecting(false);
        notifyError(cause, {
          action: "disconnect the mailbox",
          // Disconnecting stops email, so Retry asks again first.
          onRetry: () => setConfirmingDisconnect(true),
        });
      },
    );
  }

  if (!connected || form) {
    // The mailbox is connected on the other provider.
    const other =
      settings.provider && settings.provider !== provider
        ? settings.provider
        : null;
    return (
      <div className="space-y-4">
        {other && (
          <SettingsNotice>
            <p>
              {settings.mailbox ?? "The intake mailbox"} is connected through{" "}
              {INTAKE_CHANNEL_NAMES[INTAKE_MAIL_CHANNELS[other]]}.
              MikeGC reads one intake mailbox, so connecting{" "}
              {INTAKE_CHANNEL_NAMES[INTAKE_MAIL_CHANNELS[provider]]} replaces
              it.
            </p>
          </SettingsNotice>
        )}
        {form && (
          <MailboxConnectFields
            form={form}
            settings={settings}
            teams={teams}
            busy={busy}
            onChange={(patch) => onForm({ ...form, ...patch })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ToggleRow
        bare
        label="Record requests from email"
        checked={draft.emailEnabled}
        disabled={busy}
        onChange={(emailEnabled) => onChange({ emailEnabled })}
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className={ROW_LABEL_CLASS}>Connection settings</p>
          {!confirmingDisconnect && (
            <HeaderActionsMenu
              title="Connection settings actions"
              items={[
                {
                  label: "Send test email",
                  icon: Send,
                  disabled: testing || busy || disconnecting,
                  onSelect: () => sendTestEmail(orgId, setTesting),
                },
                {
                  label: "Edit connection",
                  icon: Pencil,
                  disabled: busy || disconnecting,
                  onSelect: () =>
                    onForm(
                      intakeMailboxForm(provider, settings, teams.configured),
                    ),
                },
                {
                  label: "Disconnect",
                  icon: Unplug,
                  variant: "danger",
                  disabled: busy || disconnecting,
                  onSelect: () => setConfirmingDisconnect(true),
                },
              ]}
            />
          )}
        </div>
        {settings.status.error && (
          <SettingsNotice tone="error">
            <p>{settings.status.error}</p>
          </SettingsNotice>
        )}
        {confirmingDisconnect && (
          <div
            role="group"
            aria-label="Disconnect the intake mailbox?"
            className="space-y-2"
          >
            <p className="text-sm text-gray-700">
              Disconnect? MikeGC stops reading and replying from this mailbox
              right away. Recorded requests are kept.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PillButtonUI
                tone="white"
                size="sm"
                onClick={() => setConfirmingDisconnect(false)}
              >
                Keep connected
              </PillButtonUI>
              <PillButtonUI tone="danger" size="sm" onClick={disconnect}>
                Disconnect
              </PillButtonUI>
            </div>
          </div>
        )}
      </div>
      <TextField
        label="Sender name"
        value={draft.fromName}
        placeholder="Legal"
        maxLength={80}
        onChange={(fromName) => onChange({ fromName })}
        onEnter={onSave}
      />
      <SenderDomains draft={draft} onChange={onChange} />
    </div>
  );
}

/**
 * Send the intake mailbox's test email to the admin and say how it went; a
 * failure's Retry sends it again. `busy` follows it.
 */
function sendTestEmail(orgId: string, busy: (busy: boolean) => void) {
  busy(true);
  sendIntakeMailboxTest(orgId).then(
    (sent) => {
      busy(false);
      notifySuccess(`Test email sent to ${sent.sent_to}`);
    },
    (cause) => {
      busy(false);
      notifyError(cause, {
        action: "send the test email",
        onRetry: () => sendTestEmail(orgId, busy),
      });
    },
  );
}

/** The sender domains mail is accepted from, added one at a time. */
function SenderDomains({
  draft,
  onChange,
}: {
  draft: IntakeAutomationDraft;
  onChange: Change;
}) {
  const id = useId();
  const domainError = intakeDomainInputError(draft);
  const addDomain = () => {
    const domain = normalizeIntakeDomain(draft.domainInput);
    if (!domain || domainError) return;
    onChange({
      domains: draft.domains.includes(domain)
        ? draft.domains
        : [...draft.domains, domain],
      domainInput: "",
    });
  };
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        Allowed sender domains
      </label>
      {/* Add sits inside the field, at its end. */}
      <div className="relative">
        <SettingsTextInput
          id={id}
          className="pr-14"
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          maxLength={253}
          value={draft.domainInput}
          aria-invalid={!!domainError}
          aria-describedby={domainError ? `${id}-error` : undefined}
          onChange={(event) => onChange({ domainInput: event.target.value })}
          onKeyDown={(event) => {
            // Enter adds the domain rather than saving.
            if (event.key !== "Enter") return;
            event.preventDefault();
            addDomain();
          }}
        />
        <TextButtonUI
          size="xs"
          className="absolute right-2 top-1/2 -translate-y-1/2"
          disabled={!draft.domainInput.trim() || !!domainError}
          onClick={addDomain}
        >
          Add
        </TextButtonUI>
      </div>
      {domainError && (
        <p id={`${id}-error`} className={ERROR_CLASS}>
          {domainError}
        </p>
      )}
      {draft.domains.length > 0 && (
        <ul className="mt-1.5 divide-y divide-gray-100">
          {draft.domains.map((domain) => (
            <li
              key={domain}
              className="flex min-h-9 min-w-0 items-center justify-between gap-2 pl-3 pr-1.5 text-sm text-gray-900"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{domain}</span>
              <TextButtonUI
                size="icon-xs"
                aria-label={`Remove ${domain}`}
                onClick={() =>
                  onChange({
                    domains: draft.domains.filter((item) => item !== domain),
                  })
                }
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </TextButtonUI>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The intake mailbox's connection: its address and, for Microsoft 365, the
 * Entra app's IDs and write-only secret; for Google Workspace, the service
 * account's write-only JSON key and the client ID to delegate to, read from
 * the key as it is pasted.
 */
function MailboxConnectFields({
  form,
  settings,
  teams,
  busy,
  onChange,
}: {
  form: IntakeMailboxForm;
  settings: IntakeAutomationSettings["email"];
  teams: IntakeAutomationSettings["teams"];
  busy: boolean;
  onChange: (patch: Partial<IntakeMailboxForm>) => void;
  /** While reconnecting: back to the connection that is kept. */
}) {
  const secretSaved =
    settings.provider === "graph" && settings.graph.secret_set;
  const pastedClientId = intakeServiceAccountClientId(form.serviceAccountKey);
  const delegateTo = pastedClientId || settings.gmail.client_id;
  return (
    <div className="space-y-4">
      <TextField
        label="Intake address"
        type="email"
        value={form.mailbox}
        placeholder="intake@company.com"
        maxLength={320}
        onChange={(mailbox) => onChange({ mailbox })}
      />
      {form.provider === "graph" && teams.configured && (
        <ToggleRow
          bare
          label="Use the same app as Teams"
          checked={form.useTeamsApp}
          disabled={busy}
          onChange={(useTeamsApp) => onChange({ useTeamsApp })}
        />
      )}
      {form.provider === "graph" && form.useTeamsApp ? (
        <SameAppFields
          fields={[
            { label: "Tenant ID", value: teams.tenant_id },
            { label: "Client ID", value: teams.app_id },
          ]}
          other="Teams"
          // Outlook also needs Exchange to let the app use this mailbox.
          extra="Exchange must also let this app use the intake mailbox."
        />
      ) : form.provider === "graph" ? (
        <>
          <TextField
            label="Tenant ID"
            value={form.tenantId}
            placeholder="00000000-0000-0000-0000-000000000000"
            maxLength={100}
            onChange={(tenantId) => onChange({ tenantId })}
          />
          <TextField
            label="Client ID"
            value={form.clientId}
            placeholder="The Entra app's Application (client) ID"
            maxLength={100}
            onChange={(clientId) => onChange({ clientId })}
          />
          <SecretField
            label="Client secret"
            saved={secretSaved}
            value={form.clientSecret}
            placeholder="The Entra app's client secret value"
            onChange={(clientSecret) => onChange({ clientSecret })}
          />
        </>
      ) : (
        <>
          <SecretField
            label="Service account JSON key"
            saved={settings.gmail.key_set}
            value={form.serviceAccountKey}
            placeholder={
              settings.gmail.deployment_key
                ? "Optional: empty uses this deployment's service account"
                : "Paste the JSON key file's contents"
            }
            onChange={(serviceAccountKey) => onChange({ serviceAccountKey })}
          />
          {pastedClientId === false && (
            <p role="alert" className={ERROR_CLASS}>
              This isn&apos;t a service account&apos;s JSON key.
            </p>
          )}
          {delegateTo && (
            <CopyValue
              label="Service account client ID"
              name="service account client ID"
              value={delegateTo}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Which Entra app a channel will use when it reuses `other`'s: its IDs in
 * full (they aren't secret), and that the secret is copied, never shown.
 */
function SameAppFields({
  fields,
  other,
  extra,
}: {
  /** The channel's own fields, in its order, with the other channel's values. */
  fields: { label: string; value: string | null }[];
  other: string;
  extra?: string;
}) {
  const noop = () => {};
  return (
    <>
      {fields.map((field) => (
        <TextField
          key={field.label}
          label={field.label}
          value={field.value ?? ""}
          disabled
          onChange={noop}
        />
      ))}
      <SecretField
        label="Client secret"
        saved
        value=""
        placeholder=""
        disabled
        onChange={noop}
      />
      <p className={ROW_DESCRIPTION_CLASS}>
        {`MikeGC copies the client secret from ${other}. Changing it in ${other} later doesn't change it here.`}
        {extra ? ` ${extra}` : ""}
      </p>
    </>
  );
}

/**
 * Slack: the switch, the events URL to paste into the app, its write-only
 * Signing Secret and Bot User OAuth Token, the workspace they belong to, and
 * what to fix when the app lacks a scope.
 */
function IntakeSlackFields({
  settings,
  draft,
  onChange,
  onSave,
}: {
  settings: IntakeAutomationSettings["slack"];
  draft: IntakeAutomationDraft;
  onChange: Change;
  onSave: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Once its keys are saved: saving them first turns Slack on. */}
      {settings.configured && (
        <ToggleRow
          bare
          label="Record requests from Slack"
          checked={draft.slackEnabled}
          onChange={(slackEnabled) => onChange({ slackEnabled })}
        />
      )}
      <CopyValue
        label="Events Request URL"
        name="Events Request URL"
        value={settings.events_url}
      />
      <SecretField
        label="Signing Secret"
        saved={settings.configured}
        value={draft.signingSecret}
        placeholder="Paste the app's Signing Secret"
        onChange={(signingSecret) => onChange({ signingSecret })}
        onEnter={onSave}
      />
      <SecretField
        label="Bot User OAuth Token"
        saved={settings.configured}
        value={draft.botToken}
        placeholder="xoxb-…"
        onChange={(botToken) => onChange({ botToken })}
        onEnter={onSave}
      />
      {settings.configured && (settings.team_name || settings.team_id) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className={ROW_LABEL_CLASS}>Connected workspace</p>
          <div className="min-w-0 text-right">
            <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">
              {settings.team_name ?? settings.team_id}
            </p>
            {settings.bot_user_id && (
              <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
                MikeGC bot user {settings.bot_user_id}
              </p>
            )}
          </div>
        </div>
      )}
      {settings.configured && settings.missing_scopes.length > 0 && (
        <SettingsNotice>
          <p className="font-medium">Reinstall the Slack app to send documents.</p>
          <p>
            Its token lacks {settings.missing_scopes.join(", ")}. MikeGC still
            records requests and posts text, but can&apos;t send documents or
            post under a lawyer&apos;s name. Add the scopes from the manifest
            in the setup guide under OAuth &amp; Permissions, reinstall the
            app, then paste its new Bot User OAuth Token here.
          </p>
        </SettingsNotice>
      )}
      {settings.configured && !settings.message_events_seen && (
        <SettingsNotice>
          <p>
            MikeGC hasn&apos;t received a thread message yet. Subscribe the app
            to the message.channels and message.groups bot events so
            requesters&apos; answers reach their request.
          </p>
        </SettingsNotice>
      )}
    </div>
  );
}

/**
 * Teams: the switch, the events URL for the Azure Bot, the app's IDs and
 * write-only client secret, and whether MikeGC can send documents.
 */
function IntakeTeamsFields({
  settings,
  draft,
  outlookApp,
  useOutlookApp,
  busy,
  onUseOutlookApp,
  onChange,
  onSave,
}: {
  settings: IntakeAutomationSettings["teams"];
  draft: IntakeAutomationDraft;
  /** The connected Outlook mailbox's app, which Teams can be set up with. */
  outlookApp: { tenantId: string; clientId: string } | null;
  useOutlookApp: boolean;
  busy: boolean;
  onUseOutlookApp: (use: boolean) => void;
  onChange: Change;
  onSave: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Once its keys are saved: saving them first turns Teams on. */}
      {settings.configured && (
        <ToggleRow
          bare
          label="Record requests from Teams"
          checked={draft.teamsEnabled}
          onChange={(teamsEnabled) => onChange({ teamsEnabled })}
        />
      )}
      <CopyValue
        label="Teams events URL"
        name="Teams events URL"
        value={settings.events_url}
      />
      {outlookApp && (
        <ToggleRow
          bare
          label="Use the same app as Outlook"
          checked={useOutlookApp}
          disabled={busy}
          onChange={onUseOutlookApp}
        />
      )}
      {useOutlookApp && outlookApp ? (
        <SameAppFields
          fields={[
            { label: "App ID", value: outlookApp.clientId },
            { label: "Tenant ID", value: outlookApp.tenantId },
          ]}
          other="Outlook"
        />
      ) : (
        <>
          <TextField
            label="App ID"
            value={draft.teamsAppId}
            placeholder="The Entra app's Application (client) ID"
            maxLength={100}
            onChange={(teamsAppId) => onChange({ teamsAppId })}
            onEnter={onSave}
          />
          <TextField
            label="Tenant ID"
            value={draft.teamsTenantId}
            placeholder="Your Microsoft 365 tenant ID"
            maxLength={100}
            onChange={(teamsTenantId) => onChange({ teamsTenantId })}
            onEnter={onSave}
          />
          <SecretField
            label="Client secret"
            saved={settings.configured}
            value={draft.teamsSecret}
            placeholder="The Entra app's client secret value"
            onChange={(teamsSecret) => onChange({ teamsSecret })}
            onEnter={onSave}
          />
        </>
      )}
      {settings.configured && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className={ROW_LABEL_CLASS}>Document access</p>
          <p className="text-right text-sm text-gray-900">
            {settings.files_access === null
              ? "Not checked yet"
              : settings.files_access
                ? "Available"
                : "Not set up"}
          </p>
        </div>
      )}
    </div>
  );
}

/** The tiles while the page loads: the heading, then four tiles' shapes. */
export function IntakeChannelsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex h-7 items-center">
        <div className="h-3 w-20 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
      </div>
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
          {CHANNELS.map((channel) => (
            <GlassCardUI key={channel}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                  <div className="h-5 w-5 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="h-3 w-16 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
                </div>
                <div className="h-5 w-9 shrink-0 animate-pulse rounded-full bg-gray-100 motion-reduce:animate-none" />
              </div>
            </GlassCardUI>
          ))}
        </div>
      </div>
    </div>
  );
}
