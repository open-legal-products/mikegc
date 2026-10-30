import type { IntakeDocument } from "@mike/contracts";
import type { Db } from "../../lib/supabase";
import type { ServiceResult } from "../../lib/serviceResult";
import type { IntakeScope } from "./intake.requests";
import { intakeRpc } from "./intake.shared";

const scoped = (scope: IntakeScope, requestId: string) => ({
  p_org: scope.orgId,
  p_actor: scope.actorId,
  p_request: requestId,
});

/** Whether the actor may upload documents to the request: any current member. */
export async function canAttachIntakeDocuments(
  db: Db,
  scope: IntakeScope,
  requestId: string,
): Promise<ServiceResult<boolean>> {
  return intakeRpc<boolean>(db, "intake_can_read", scoped(scope, requestId));
}

/**
 * Link an uploaded document to its request. The upload worker calls this as
 * soon as the document row exists; repeating it for the same pair is a no-op.
 */
export function attachIntakeDocument(
  db: Db,
  scope: IntakeScope,
  requestId: string,
  documentId: string,
) {
  return intakeRpc<null>(db, "intake_attach_document", {
    ...scoped(scope, requestId),
    p_document: documentId,
  });
}

export function listIntakeDocuments(
  db: Db,
  scope: IntakeScope,
  requestId: string,
) {
  return intakeRpc<IntakeDocument[]>(
    db,
    "intake_list_documents",
    scoped(scope, requestId),
  );
}
