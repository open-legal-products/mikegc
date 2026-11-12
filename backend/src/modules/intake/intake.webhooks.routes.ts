import express, { Router } from "express";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
  receiveGraphNotification,
  receiveSlackEvent,
  receiveTeamsActivity,
} from "./intake.service";
import { intakeId } from "./intake.validation";

/**
 * Where Slack, Teams and Microsoft Graph deliver what automated intake
 * reads. Mounted outside the signed-in /intake API and ahead of the global
 * JSON parser: these callers authenticate with a signature, a token or a
 * client state, not a session.
 */
export const intakeWebhooksRouter = Router();

// Slack signs the exact bytes it sent, so this body is read raw.
intakeWebhooksRouter.post(
  "/slack/:webhookId",
  express.raw({ type: "*/*", limit: "1mb" }),
  asyncRoute(async (req, res) => {
    if (!intakeId.safeParse(req.params.webhookId).success)
      return void res.status(404).json({ detail: "Not found." });
    const result = await receiveSlackEvent(
      createServerSupabase(),
      req.params.webhookId,
      Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      {
        timestamp: req.get("x-slack-request-timestamp"),
        signature: req.get("x-slack-signature"),
      },
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    if (result.data.challenge !== undefined)
      return void res.json({ challenge: result.data.challenge });
    res.json({ ok: true });
  }),
);

// The organization's Teams bot: each activity carries a Bot Connector token.
intakeWebhooksRouter.post(
  "/teams/:webhookId",
  express.json({ limit: "1mb" }),
  asyncRoute(async (req, res) => {
    if (!intakeId.safeParse(req.params.webhookId).success)
      return void res.status(404).json({ detail: "Not found." });
    const result = await receiveTeamsActivity(
      createServerSupabase(),
      req.params.webhookId,
      req.get("authorization"),
      req.body,
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(200).json({});
  }),
);

// Microsoft Graph's new-mail notifications for an Outlook intake mailbox.
// Creating a subscription first asks this URL to echo a validation token
// as plain text.
intakeWebhooksRouter.post(
  "/graph/:webhookId",
  express.json({ limit: "1mb" }),
  asyncRoute(async (req, res) => {
    if (!intakeId.safeParse(req.params.webhookId).success)
      return void res.status(404).json({ detail: "Not found." });
    const validationToken =
      typeof req.query.validationToken === "string" ? req.query.validationToken : undefined;
    const result = await receiveGraphNotification(
      createServerSupabase(),
      req.params.webhookId,
      validationToken,
      req.body,
    );
    if (result.kind === "validation")
      return void res
        .status(200)
        .type("text/plain")
        .set("X-Content-Type-Options", "nosniff")
        .send(result.token);
    if (result.kind === "refused")
      return void res.status(result.status).json({ detail: "Not accepted." });
    res.status(202).end();
  }),
);

intakeWebhooksRouter.use(routerErrorHandler("[intake-webhooks]"));
