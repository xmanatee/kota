import { selectedScopeSelectorId } from "#core/server/scope-selector.js";
import type { RetractRequest, RetractResult } from "./client.js";
import type {
  RetractProvider,
  RetractScopeContext,
} from "./retract-types.js";
import { retractTarget } from "./store-retractor.js";

export type RetractProviderOptions = {
  resolveScopeContext?: (
    scopeId: string | null | undefined,
  ) => RetractScopeContext | { error: "unknown_scope"; scopeId: string };
};

/** Owns cross-store targeting; the selected store owns removal semantics. */
export class RetractProviderImpl implements RetractProvider {
  private readonly resolveScopeContext:
    | NonNullable<RetractProviderOptions["resolveScopeContext"]>
    | undefined;

  constructor(options: RetractProviderOptions = {}) {
    this.resolveScopeContext = options.resolveScopeContext;
  }

  async retract(
    request: RetractRequest,
    scope?: RetractScopeContext,
  ): Promise<RetractResult> {
    const resolvedScope =
      scope ?? this.resolveScopeContext?.(selectedScopeSelectorId(request));
    if (!resolvedScope) throw new Error("Retract requires a scope context");
    if ("error" in resolvedScope) {
      throw new Error(`Unknown scope: ${resolvedScope.scopeId}`);
    }
    try {
      return await retractTarget({ request, scope: resolvedScope });
    } catch (error) {
      return {
        ok: false,
        reason: "retract_failed",
        target: request.target,
        identifier: request.identifier,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
