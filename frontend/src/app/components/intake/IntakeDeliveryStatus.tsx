"use client";
import type { IntakeDelivery } from "@mike/contracts";
import { notifyError } from "@/app/lib/userFacingError";
import { notifySuccess } from "@mike/client";
import { cn } from "@/app/lib/utils";
import { TextButtonUI } from "@mike/ui";
import { intakeDeliveryStatus } from "./intakeConversation";

/**
 * How a message sent to the requester is going, in plain text under its
 * entry: Sending, Sent, or why it couldn't be sent, with any documents left
 * out. One that failed offers Retry and Copy text, each naming the message
 * it acts on, so a member can send it again or paste it themselves.
 */
export function IntakeDeliveryStatus({
  delivery,
  name,
  text,
  retrying,
  onRetry,
}: {
  delivery: IntakeDelivery;
  /** The message, as the controls name it: "the question". */
  name: string;
  /** What Copy text copies; without it there is nothing to copy. */
  text?: string | null;
  retrying?: boolean;
  onRetry: () => void;
}) {
  const failed = delivery.status === "failed";
  const leftOut = delivery.documents.filter((document) => document.left_out);
  const sent = delivery.documents.filter((document) => !document.left_out);
  return (
    <div className="space-y-1">
      <p
        className={cn(
          "text-xs",
          failed ? "text-red-600" : "text-gray-500",
        )}
      >
        {intakeDeliveryStatus(delivery)}
        {delivery.status === "sent" && sent.length > 0 && (
          <> with {sent.map((document) => document.filename).join(", ")}</>
        )}
      </p>
      {leftOut.length > 0 && (
        <p className="text-xs text-gray-500">
          Not sent: {leftOut.map((document) => document.filename).join(", ")}
        </p>
      )}
      {failed && (
        <div className="flex flex-wrap items-center gap-1">
          <TextButtonUI
            size="xs"
            className="-ml-2"
            loading={retrying}
            disabled={retrying}
            aria-label={`Retry sending ${name}`}
            onClick={onRetry}
          >
            Retry
          </TextButtonUI>
          {text && (
            <TextButtonUI
              size="xs"
              aria-label={`Copy the text of ${name}`}
              onClick={() =>
                // Inside the promise, so a browser without clipboard access
                // reports it like any other failure.
                Promise.resolve()
                  .then(() => navigator.clipboard.writeText(text))
                  .then(
                    () => notifySuccess("Text copied"),
                    (e) => notifyError(e, { action: "copy the text" }),
                  )
              }
            >
              Copy text
            </TextButtonUI>
          )}
        </div>
      )}
    </div>
  );
}
