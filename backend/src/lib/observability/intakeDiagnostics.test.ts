import { it, expect, afterEach } from "vitest";
import * as Sentry from "@sentry/node";
import { resetSentryForTests, scrubEvent } from "./sentry";
import { privacyBoundaryIntegration } from "./sentryPrivacy";
import { intakeRpc } from "../../modules/intake/intake.shared";

afterEach(async () => { await Sentry.close(); });

it("retains the failing RPC identifier and cause through the final SDK envelope", async () => {
  const events: unknown[] = [];
  const cause = { code: "42703", message: "SYNTHETIC_PRIVATE_DOCUMENT" };
  resetSentryForTests("community");
  Sentry.init({
    dsn: "https://test@sentry.invalid/1",
    defaultIntegrations: false,
    integrations: [privacyBoundaryIntegration()],
    beforeSend: scrubEvent,
    transport: () => ({
      send: async envelope => {
        for (const [header, payload] of envelope[1])
          if (header.type === "event") events.push(payload);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  const db = { rpc: async () => ({ data: null, error: cause }) };
  const failure = await intakeRpc(db as never, "intake_update_automated", {});
  if (failure.ok || failure.kind !== "error") throw Error("expected failure");
  expect((failure.error as Error).cause).toBe(cause);
  Sentry.withScope(scope => {
    scope.setTag("operation", "intake.reply");
    Sentry.captureException(failure.error);
  });
  await Sentry.flush(2000);
  expect(events).toHaveLength(1);
  // The RPC is named beside the flow it failed in, not in place of it.
  expect((events[0] as { tags: unknown }).tags).toMatchObject({
    operation: "intake.reply", failed_operation: "intake_update_automated",
  });
  expect(JSON.stringify(events)).not.toContain("SYNTHETIC_PRIVATE_DOCUMENT");
  expect(JSON.stringify(events)).toContain("intake_update_automated");
  expect(JSON.stringify(events)).toContain("42703");
});
