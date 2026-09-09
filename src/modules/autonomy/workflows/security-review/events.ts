import { defineScopedModuleEvent } from "#core/events/scope.js";

export const securityFindingPublicationRequested = defineScopedModuleEvent<{
  taskId: string;
  idempotencyKey: string;
}>("autonomy.security-finding.publication.requested", ["taskId", "idempotencyKey"]);
