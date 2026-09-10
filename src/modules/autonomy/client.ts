import { createDirectoryScopeSelector } from "#core/daemon/scope-selection.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { KotaClientScopeError } from "#root/client/kota-client.generated.js";
import { attentionInspectionOperation, digestInspectionOperation, reportInspectionOperation } from "./inspection.js";
import { autonomyInspectionRoots } from "./inspection-roots.js";
import { DEFAULT_REPORT_WINDOW_DAYS } from "./report/aggregate.js";
import type { AutonomyReportDataWithControlCoverage } from "./report/control-coverage-report-window.js";
import type { RenderedAttention } from "./workflows/attention-digest/step.js";
import type { renderOnDemandDigest } from "./workflows/daily-digest/on-demand.js";

export type AttentionResult = { data: Pick<RenderedAttention, "items">; text: string };
export type ReportOptions = ScopeSelector & { days?: number };
export type DigestOptions = ScopeSelector & { windowEndMs?: number };

export interface AutonomyClient {
  attention(scope?: ScopeSelector): Promise<AttentionResult>;
  digest(options?: DigestOptions): Promise<ReturnType<typeof renderOnDemandDigest>>;
  report(options?: ReportOptions): Promise<AutonomyReportDataWithControlCoverage>;
}

/** Resolve authority where the reader runs, never from a client's artifact directory. */
export function createAutonomyClient(defaultScopeRoot: string, offlineStateDir?: string): AutonomyClient {
  const select = createDirectoryScopeSelector({ defaultScopeRoot });
  const roots = (scope?: ScopeSelector) => {
    const selected = select(scope?.scopeId);
    if (!selected.ok) throw new KotaClientScopeError(selected.error.scopeId);
    return autonomyInspectionRoots(selected.scope.scopeRoot, offlineStateDir);
  };
  return {
    async digest(options) {
      return runWorkflowBlockingOperation(digestInspectionOperation, {
        ...roots(options), windowEndMs: options?.windowEndMs ?? Date.now(),
      }, { signal: AbortSignal.timeout(30_000) });
    },
    async attention(scope) {
      return runWorkflowBlockingOperation(attentionInspectionOperation, roots(scope), { signal: AbortSignal.timeout(30_000) });
    },
    async report(options) {
      const days = options?.days ?? DEFAULT_REPORT_WINDOW_DAYS;
      if (!Number.isSafeInteger(days) || days <= 0) throw new Error("Report days must be a positive integer");
      return runWorkflowBlockingOperation(reportInspectionOperation, {
        ...roots(options), days, windowEndMs: Date.now(),
      }, { signal: AbortSignal.timeout(30_000) });
    },
  };
}
