"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type {
  IntakeDelivery,
  IntakeDocument,
  IntakeEvent,
  IntakeMember,
  IntakeMessage,
} from "@mike/contracts";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { cn } from "@/app/lib/utils";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { IntakeActorAvatar } from "./IntakeActorAvatar";
import { IntakeDeliveryStatus } from "./IntakeDeliveryStatus";
import { INTAKE_TEXTAREA_CLASS } from "./IntakeDetailsPanel";
import type { IntakeUpload } from "./IntakeDocuments";
import { IntakeNoteDocuments, NOTE_TITLE_CLASS } from "./IntakeNoteForm";
import { intakeOutgoingName } from "./intakeActivity";
import { INTAKE_CHANNEL_LABELS } from "./intakeConversation";
import type { IntakeOriginalMessage } from "./intakeDescription";
import { formatIntakeDateTime } from "./intakeLabels";

/**
 * The messages exchanged with the requester, as opposed to work in the app:
 * questions, their replies, and answers: a resolution's reply, or MikeGC's
 * answer to a reply.
 */
const REQUESTER_KINDS = new Set<IntakeMessage["kind"]>([
  "question",
  "reply",
  "answer",
]);

/** Whether a message belongs in Messages rather than the activity. */
export const isIntakeRequesterMessage = (message: IntakeMessage) =>
  REQUESTER_KINDS.has(message.kind);

/**
 * Documents a resolution sent to the requester with no reply text, with how
 * the sending went. A reply with text is a message of its own.
 */
export interface IntakeSentResolution {
  /** The change it was sent with, saying who resolved and when. */
  event: IntakeEvent;
  delivery: IntakeDelivery;
}

interface Entry {
  key: string;
  at: string;
  /** From the requester's side, shown on the left. */
  incoming: boolean;
  author: string;
  mikegc: boolean;
  /** Where a requester's message was written, such as Slack. */
  channel?: string | null;
  /** What it was, beside the author, such as a resolution reply. */
  label?: string;
  body: string;
  photo?: string | null;
  /** A stored message, which can carry documents. */
  messageId?: string;
  delivery?: IntakeDelivery | null;
  deliveryName?: string;
}

/** A message to the requester being written, posted in the request's thread. */
export interface IntakeMessageComposer {
  /** Who the message reaches, such as everyone in a Slack channel. */
  audience: string;
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * The conversation with the requester, in its own section, collapsed until
 * opened: the thread the request was made from, the questions sent to the
 * requester, their replies and the resolution reply, as a chat, oldest
 * first. The header says how many there are, how many weren't sent and
 * whether a reply is new, so neither hides while it is collapsed. Opened,
 * the messages scroll within a fixed height, starting at the newest, and a
 * box under them writes the next message to the requester.
 */
export function IntakeMessages({
  original,
  messages,
  resolutions,
  createdAt,
  members,
  documents,
  uploading,
  open,
  newReply,
  retrying,
  onOpenChange,
  onOpenDocument,
  onRetry,
  composer,
}: {
  original: IntakeOriginalMessage | null;
  /** Questions and replies, in any order. */
  messages: IntakeMessage[];
  resolutions: IntakeSentResolution[];
  /** When the request was made, for an original message with no time. */
  createdAt: string;
  members: IntakeMember[];
  documents: IntakeDocument[];
  uploading: IntakeUpload[];
  open: boolean;
  /** A reply came in since the request was last opened. */
  newReply: boolean;
  /** Outbox rows being sent again. */
  retrying: string[];
  onOpenChange: (open: boolean) => void;
  onOpenDocument: (documentId: string) => void;
  onRetry: (outboundId: string) => void;
  /** Absent where the requester can't be messaged from here. */
  composer?: IntakeMessageComposer;
}) {
  const heading = useId();
  const panel = useId();
  const composerId = useId();
  const audienceId = useId();
  const history = useRef<HTMLDivElement>(null);
  const photo = (id: string | null) =>
    members.find((m) => m.user_id === id)?.profile_photo;
  const entries: Entry[] = [
    ...(original?.entries ?? []).map((entry, i) => ({
      key: `o${i}`,
      at: entry.sentAt ?? createdAt,
      incoming: true,
      author: entry.author,
      mikegc: false,
      channel: original?.channel,
      body: entry.text,
    })),
    ...messages.map((message) => ({
      key: message.id,
      at: message.created_at,
      incoming: message.kind === "reply",
      author: message.automated ? "MikeGC" : message.author_name,
      mikegc: !!message.automated,
      channel:
        message.external_author &&
        INTAKE_CHANNEL_LABELS[message.external_author.source],
      ...(message.kind === "answer" && !message.automated ? { label: "Resolution" } : {}),
      body: message.body,
      photo: photo(message.author_id),
      messageId: message.id,
      delivery: message.delivery,
      deliveryName: intakeOutgoingName(
        message.kind !== "answer"
          ? "question"
          : message.automated
            ? "answer"
            : "resolution",
      ),
    })),
    ...resolutions.map(({ event, delivery }) => ({
      key: `e${event.id}`,
      at: event.created_at,
      incoming: false,
      author: event.actor_name ?? "Former member",
      mikegc: false,
      label: "Resolution",
      body: "",
      photo: photo(event.actor_id),
      delivery,
      deliveryName: intakeOutgoingName("resolution"),
    })),
  ];
  // Stable, so a thread's messages that share a minute keep their order.
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const failed = entries.filter((e) => e.delivery?.status === "failed").length;
  // Like a chat, the history opens at its newest message and follows new ones.
  useEffect(() => {
    const box = history.current;
    if (open && box) box.scrollTop = box.scrollHeight;
  }, [open, entries.length]);
  return (
    <GlassCardUI>
      <section aria-labelledby={heading}>
        <h2 id={heading} className="text-sm font-medium text-gray-900">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => onOpenChange(!open)}
            className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl px-5 py-4 text-left transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
            <span>Messages</span>
            <span className="font-normal text-gray-500">{entries.length}</span>
            {failed > 0 && (
              <span className="text-xs font-normal text-red-600">
                {failed === 1 ? "1 not sent" : `${failed} not sent`}
              </span>
            )}
            {/* Pushed to the header's right edge. */}
            {newReply && (
              <span className="ml-auto text-xs font-normal text-blue-600">
                New reply
              </span>
            )}
          </button>
        </h2>
        {open && (
          <div id={panel} className="space-y-4 px-5 pb-5">
            {/* Scrolls by keyboard too, so it can take focus. */}
            <div
              ref={history}
              tabIndex={0}
              role="region"
              aria-label="Message history"
              className="-mx-5 max-h-[28rem] space-y-4 overflow-y-auto px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
            >
              {original?.subject && (
                <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                  <span className="text-gray-500">Subject:</span>{" "}
                  {original.subject}
                </p>
              )}
              <ol
                aria-label="Messages with the requester"
                className="space-y-4"
              >
                {entries.map((entry) => (
                  <IntakeMessageBubble
                    key={entry.key}
                    entry={entry}
                    documents={documents.filter(
                      (d) =>
                        !!entry.messageId && d.message_id === entry.messageId,
                    )}
                    uploading={uploading.filter(
                      (u) =>
                        !!entry.messageId && u.messageId === entry.messageId,
                    )}
                    retrying={
                      !!entry.delivery &&
                      retrying.includes(entry.delivery.outbound_id)
                    }
                    onOpenDocument={onOpenDocument}
                    onRetry={onRetry}
                  />
                ))}
              </ol>
              {original?.shortened && (
                <p className="text-xs text-gray-500">
                  The original message was shortened to fit.
                </p>
              )}
              {!!original?.notAttached.length && (
                <div className="text-xs text-gray-500">
                  <p className="font-medium text-gray-700">Not attached</p>
                  <ul className="mt-1 space-y-0.5 [overflow-wrap:anywhere]">
                    {original.notAttached.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {composer && (
              <div className="border-t border-gray-100 pt-4">
                <label
                  htmlFor={composerId}
                  className={cn("block", NOTE_TITLE_CLASS)}
                >
                  Message the requester
                </label>
                <p
                  id={audienceId}
                  className="mb-2 text-xs text-gray-500 [overflow-wrap:anywhere]"
                >
                  {composer.audience}
                </p>
                {/* The send button sits inside the box, under the text. */}
                <div className="rounded-lg bg-gray-100 transition-shadow focus-within:ring-2 focus-within:ring-gray-300/45">
                  <textarea
                    id={composerId}
                    aria-describedby={audienceId}
                    rows={2}
                    maxLength={20000}
                    placeholder="What do you need from the requester?"
                    value={composer.value}
                    disabled={composer.locked}
                    onChange={(event) => composer.onChange(event.target.value)}
                    className={cn(
                      INTAKE_TEXTAREA_CLASS,
                      "min-h-20 bg-transparent focus:border-transparent focus:ring-0",
                    )}
                  />
                  <div className="flex justify-end px-2 pb-2">
                    <button
                      type="button"
                      disabled={!composer.value.trim() || composer.locked}
                      onClick={composer.onSubmit}
                      className="rounded-md px-2 text-sm font-medium text-gray-900 transition-colors hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:text-gray-400"
                    >
                      Ask requester
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </GlassCardUI>
  );
}

/**
 * One message as a chat bubble: the requester's side left, ours right;
 * MikeGC's blue and everyone else's grey.
 */
function IntakeMessageBubble({
  entry,
  documents,
  uploading,
  retrying,
  onOpenDocument,
  onRetry,
}: {
  entry: Entry;
  documents: IntakeDocument[];
  uploading: IntakeUpload[];
  retrying: boolean;
  onOpenDocument: (documentId: string) => void;
  onRetry: (outboundId: string) => void;
}) {
  const { incoming, delivery } = entry;
  return (
    <li
      className={cn(
        "flex min-w-0 gap-2",
        incoming ? "justify-start" : "justify-end",
      )}
    >
      {incoming && (
        <span className="pt-0.5">
          <IntakeActorAvatar name={entry.author} photo={entry.photo} />
        </span>
      )}
      <div
        className={cn(
          "flex min-w-0 max-w-[85%] flex-col gap-1",
          incoming ? "items-start" : "items-end",
        )}
      >
        <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
          <span className="font-medium text-gray-700">{entry.author}</span>
          {incoming && entry.channel && ` · ${entry.channel}`}
          {entry.label && ` · ${entry.label}`} ·{" "}
          <time dateTime={entry.at}>{formatIntakeDateTime(entry.at)}</time>
        </p>
        {/* Documents sent alone have no text: their delivery lists them. */}
        {entry.body && (
          <p
            className={cn(
              "whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]",
              // MikeGC's own messages in Mike azure; everyone else's grey.
              entry.mikegc
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-900",
            )}
          >
            {entry.body}
          </p>
        )}
        <IntakeNoteDocuments
          documents={documents}
          uploading={uploading}
          onOpen={onOpenDocument}
        />
        {delivery && entry.deliveryName && (
          <IntakeDeliveryStatus
            delivery={delivery}
            name={entry.deliveryName}
            text={entry.body}
            retrying={retrying}
            onRetry={() => onRetry(delivery.outbound_id)}
          />
        )}
      </div>
    </li>
  );
}

/** The collapsed section's shape while the request loads. */
export function IntakeMessagesSkeleton() {
  return (
    <GlassCardUI>
      <div className="flex items-center gap-2 px-5 py-4">
        <SkeletonLine className="h-4 w-4" />
        <SkeletonLine className="w-20" />
      </div>
    </GlassCardUI>
  );
}
