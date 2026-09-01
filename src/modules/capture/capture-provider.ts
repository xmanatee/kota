import { selectedScopeSelectorId } from "#core/server/scope-selector.js";
import {
  CAPTURE_TARGET_ORDER,
  type CaptureClassifier,
  type CaptureProvider,
  type CaptureScopeContext,
  type CaptureTarget,
} from "./capture-types.js";
import type { CaptureFilter, CaptureResult } from "./client.js";
import { writeCaptureTarget } from "./store-writer.js";

export type CaptureProviderOptions = {
  classifier?: CaptureClassifier;
  resolveScopeContext?: (
    scopeId: string | null | undefined,
  ) => CaptureScopeContext | { error: "unknown_scope"; scopeId: string };
};

/** Owns classification and target selection; each selected store owns its write. */
export class CaptureProviderImpl implements CaptureProvider {
  private readonly classifier?: CaptureClassifier;
  private readonly resolveScopeContext:
    | NonNullable<CaptureProviderOptions["resolveScopeContext"]>
    | undefined;

  constructor(options: CaptureProviderOptions = {}) {
    this.classifier = options.classifier;
    this.resolveScopeContext = options.resolveScopeContext;
  }

  async capture(
    text: string,
    filter?: CaptureFilter,
    scope?: CaptureScopeContext,
  ): Promise<CaptureResult> {
    const trimmed = text.trim();
    const resolvedScope =
      scope ?? this.resolveScopeContext?.(selectedScopeSelectorId(filter));
    if (!resolvedScope) {
      throw new Error("Capture requires a scope context");
    }
    if ("error" in resolvedScope) {
      throw new Error(`Unknown scope: ${resolvedScope.scopeId}`);
    }
    if (trimmed === "") return this.ambiguous();

    let target: CaptureTarget;
    if (filter?.target) {
      target = filter.target;
    } else {
      if (!this.classifier) return this.ambiguous();
      const classification = await this.classifier.classify({
        text: trimmed,
        ...(filter?.hint !== undefined && { hint: filter.hint }),
        available: CAPTURE_TARGET_ORDER,
      });
      if (classification.kind === "ambiguous") return this.ambiguous();
      target = classification.target;
    }

    try {
      return await writeCaptureTarget({
        target,
        text: trimmed,
        scope: resolvedScope,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "write_failed",
        target,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ambiguous(): CaptureResult {
    return {
      ok: false,
      reason: "ambiguous",
      suggestions: CAPTURE_TARGET_ORDER,
    };
  }
}
