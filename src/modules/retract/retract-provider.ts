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
import type { RetractRequest, RetractResult } from "./client.js";
import type {
  RetractContributor,
  RetractContributorResult,
  RetractProjectContext,
  RetractProvider,
  RetractTarget,
} from "./retract-types.js";

export type RetractProviderOptions = {
  resolveProjectContext?: (
    projectId: string | null | undefined,
  ) => RetractProjectContext | { error: "unknown_project"; projectId: string };
};

export class RetractProviderImpl implements RetractProvider {
  private readonly byTarget = new Map<RetractTarget, RetractContributor>();
  private readonly order: RetractTarget[] = [];
  private readonly resolveProjectContext:
    | NonNullable<RetractProviderOptions["resolveProjectContext"]>
    | undefined;

  constructor(options: RetractProviderOptions = {}) {
    this.resolveProjectContext = options.resolveProjectContext;
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
    project?: RetractProjectContext,
  ): Promise<RetractResult> {
    const resolvedProject =
      project ?? this.resolveProjectContext?.(request.projectId);
    if (resolvedProject && "error" in resolvedProject) {
      throw new Error(`Unknown project: ${resolvedProject.projectId}`);
    }
    const contributor = this.byTarget.get(request.target);
    if (!contributor) {
      return { ok: false, reason: "no_contributors" };
    }
    let outcome: RetractContributorResult;
    try {
      outcome = await runContributor(contributor, request, resolvedProject);
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
  project?: RetractProjectContext,
): Promise<RetractContributorResult> {
  switch (request.target) {
    case "memory":
      if (contributor.target !== "memory")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ id: request.id, ...(project && { project }) });
    case "knowledge":
      if (contributor.target !== "knowledge")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ slug: request.slug, ...(project && { project }) });
    case "tasks":
      if (contributor.target !== "tasks")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ id: request.id, ...(project && { project }) });
    case "inbox":
      if (contributor.target !== "inbox")
        throw new Error("retract: contributor target mismatch");
      return contributor.retract({ path: request.path, ...(project && { project }) });
  }
}
