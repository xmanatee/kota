/**
 * RetractProviderImpl — routes one typed retract request to one
 * registered contributor.
 *
 * Routing rules:
 *
 * - Caller passes `request` whose `target` names exactly one contributor.
 * - If the named contributor is not registered, surface
 *   `no_contributors` (mirrors the capture seam's shape for the same
 *   condition).
 * - The contributor returns either a removed record or a typed
 *   `not_found`; the seam translates that into the outer `RetractResult`
 *   envelope. There is no implicit cross-target search.
 * - A contributor that throws becomes a typed `contributor_failed` arm.
 */
import { selectedScopeSelectorId } from "#core/server/scope-selector.js";
import type { RetractRequest, RetractResult } from "./client.js";
import type {
  RetractContributor,
  RetractContributorResult,
  RetractProvider,
  RetractScopeContext,
  RetractTarget,
} from "./retract-types.js";

export type RetractProviderOptions = {
  resolveScopeContext?: (
    scopeId: string | null | undefined,
  ) => RetractScopeContext | { error: "unknown_scope"; scopeId: string };
};

export class RetractProviderImpl implements RetractProvider {
  private readonly byTarget = new Map<RetractTarget, RetractContributor>();
  private readonly order: RetractTarget[] = [];
  private readonly resolveScopeContext:
    | NonNullable<RetractProviderOptions["resolveScopeContext"]>
    | undefined;

  constructor(options: RetractProviderOptions = {}) {
    this.resolveScopeContext = options.resolveScopeContext;
  }

  register(contributor: RetractContributor): void {
    if (!this.byTarget.has(contributor.target)) {
      this.order.push(contributor.target);
    }
    this.byTarget.set(contributor.target, contributor);
  }

  contributors(): ReadonlyArray<RetractTarget> {
    return this.order.slice();
  }

  async retract(
    request: RetractRequest,
    scope?: RetractScopeContext,
  ): Promise<RetractResult> {
    const resolvedScope =
      scope ?? this.resolveScopeContext?.(selectedScopeSelectorId(request));
    if (resolvedScope && "error" in resolvedScope) {
      throw new Error(`Unknown scope: ${resolvedScope.scopeId}`);
    }
    const contributor = this.byTarget.get(request.target);
    if (!contributor) {
      return { ok: false, reason: "no_contributors" };
    }
    let outcome: RetractContributorResult;
    try {
      outcome = await runContributor(contributor, request, resolvedScope);
    } catch (err) {
      return {
        ok: false,
        reason: "contributor_failed",
        target: contributor.target,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (outcome.kind === "removed") {
      return { ok: true, record: outcome.record };
    }
    return {
      ok: false,
      reason: "not_found",
      target: contributor.target,
      identifier: outcome.identifier,
    };
  }
}

function runContributor(
  contributor: RetractContributor,
  request: RetractRequest,
  scope?: RetractScopeContext,
): Promise<RetractContributorResult> {
  switch (request.target) {
    case "memory":
      if (contributor.target !== "memory")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ id: request.id, ...(scope && { scope }) });
    case "knowledge":
      if (contributor.target !== "knowledge")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ slug: request.slug, ...(scope && { scope }) });
    case "tasks":
      if (contributor.target !== "tasks")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ id: request.id, ...(scope && { scope }) });
    case "inbox":
      if (contributor.target !== "inbox")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ path: request.path, ...(scope && { scope }) });
  }
}
