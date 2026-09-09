import { z } from "zod";
import type { ModuleContext } from "#core/modules/module-types.js";
import { architectureReviewRequested } from "./events.js";

export const reviewRequestSchema = z.object({
  targetScope: z.string().trim().min(1).default("repo"),
  reason: z.string().trim().min(1).default("Operator requested investigation"),
}).strict();

export async function requestArchitectureReview(
  ctx: Pick<ModuleContext, "client">,
  raw: unknown,
  selectedScopeId?: string,
) {
  const request = reviewRequestSchema.parse(raw);
  const scopes = await ctx.client.scopes.list();
  if (!scopes.ok) return scopes;
  const scopeId = selectedScopeId ?? scopes.activeScopeId ?? scopes.defaultScopeId;
  if (!scopes.scopes.some((scope) => scope.scopeId === scopeId)) {
    return { ok: false as const, reason: "unknown_scope" as const, scopeId };
  }
  return ctx.client.workflow.triggerByName("architecture-gardener", {
    scopeId,
    event: architectureReviewRequested.name,
    payload: { ...request, scopeId },
  });
}
