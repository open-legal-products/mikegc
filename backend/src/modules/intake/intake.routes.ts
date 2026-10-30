import { Router, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import {
  sendServiceFailure,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  commandIntakeRequest,
  editIntakeRequest,
  getIntakeRequest,
  listIntakeDocuments,
  listIntakeEvents,
  listIntakeMembers,
  listIntakeMessages,
  listIntakeRequests,
  submitIntakeRequest,
  type IntakeScope,
} from "./intake.service";
import {
  intakeCommands,
  intakeEdit,
  intakeId,
  intakeList,
  intakePage,
  intakeSubmit,
  type IntakeCommandAction,
} from "./intake.validation";

export const intakeRouter = Router();
intakeRouter.use(requireAuth);
intakeRouter.param("orgId", (req, res, next, value) => {
  if (!intakeId.safeParse(value).success)
    return void res.status(400).json({ detail: "Invalid organization ID." });
  next();
});
intakeRouter.param("requestId", (req, res, next, value) => {
  if (!intakeId.safeParse(value).success)
    return void res.status(400).json({ detail: "Invalid request ID." });
  next();
});
/** The actor always comes from authentication, never from the request body. */
const scopeOf = (orgId: string, res: Response): IntakeScope => ({
  orgId,
  actorId: res.locals.userId,
});
function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
  if (!result.ok) return void sendServiceFailure(res, result);
  res.status(status).json(result.data);
}

intakeRouter.get(
  "/:orgId/members",
  asyncRoute(async (req, res) => {
    send(
      res,
      await listIntakeMembers(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
      ),
    );
  }),
);
intakeRouter.get(
  "/:orgId/requests",
  asyncRoute(async (req, res) => {
    const parsed = intakeList.safeParse(req.query);
    if (!parsed.success)
      return void res.status(400).json({ detail: "Invalid request filters." });
    send(
      res,
      await listIntakeRequests(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
        parsed.data,
      ),
    );
  }),
);
intakeRouter.post(
  "/:orgId/requests",
  asyncRoute(async (req, res) => {
    const parsed = intakeSubmit.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({
        detail:
          "Enter a subject, the request, the requester's name and a valid email, target date and timezone if needed.",
      });
    const result = await submitIntakeRequest(
      createServerSupabase(),
      scopeOf(req.params.orgId, res),
      parsed.data,
    );
    send(res, result, result.ok && !result.data.replayed ? 201 : 200);
  }),
);
intakeRouter.get(
  "/:orgId/requests/:requestId",
  asyncRoute(async (req, res) => {
    send(
      res,
      await getIntakeRequest(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
        req.params.requestId,
      ),
    );
  }),
);
intakeRouter.patch(
  "/:orgId/requests/:requestId",
  asyncRoute(async (req, res) => {
    const parsed = intakeEdit.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ detail: "Check the request details." });
    send(
      res,
      await editIntakeRequest(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
        req.params.requestId,
        parsed.data,
      ),
    );
  }),
);
intakeRouter.get(
  "/:orgId/requests/:requestId/documents",
  asyncRoute(async (req, res) => {
    send(
      res,
      await listIntakeDocuments(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
        req.params.requestId,
      ),
    );
  }),
);
for (const [path, read] of [
  ["messages", listIntakeMessages],
  ["events", listIntakeEvents],
] as const) {
  intakeRouter.get(
    `/:orgId/requests/:requestId/${path}`,
    asyncRoute(async (req, res) => {
      const parsed = intakePage.safeParse(req.query);
      if (!parsed.success)
        return void res.status(400).json({ detail: "Invalid page." });
      const result: ServiceResult<unknown[]> = await read(
        createServerSupabase(),
        scopeOf(req.params.orgId, res),
        req.params.requestId,
        parsed.data,
      );
      send(res, result);
    }),
  );
}
for (const action of Object.keys(intakeCommands) as IntakeCommandAction[]) {
  intakeRouter.post(
    `/:orgId/requests/:requestId/${action}`,
    asyncRoute(async (req, res) => {
      const parsed = intakeCommands[action].safeParse(req.body);
      if (!parsed.success)
        return void res
          .status(400)
          .json({ detail: "Check the command and note fields." });
      send(
        res,
        await commandIntakeRequest(
          createServerSupabase(),
          scopeOf(req.params.orgId, res),
          req.params.requestId,
          action,
          parsed.data,
        ),
      );
    }),
  );
}
intakeRouter.use(routerErrorHandler("[intake]"));
