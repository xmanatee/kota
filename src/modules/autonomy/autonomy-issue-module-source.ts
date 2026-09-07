import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import {
  moduleOperationHealthPattern,
  moduleOperationLabel,
} from "./autonomy-issue-module-failure.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";
import { emitHealth } from "./autonomy-issue-source-shared.js";

type ModuleFailureSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

export function subscribeModuleOperationFailures(
  ctx: ModuleFailureSourceContext,
): void {
  ctx.events.subscribe("module.operation.failed", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    const pattern = moduleOperationHealthPattern({
      module: payload.module,
      operation: payload.operation,
      identity: payload,
    });
    emitHealth(ctx, runtime.scopeId, {
      observation: "present",
      ...pattern,
      evidenceRefs: [{
        kind: "module-log",
        ref: `.kota/modules/${payload.module}/logs.jsonl`,
      }],
      observationCount: 1,
      createdAt: payload.observedAt,
    });
  });
  ctx.events.subscribe("module.operation.recovered", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    const projection = decodeAutonomyIssueProjection(
      runtime.runState.readScopeStateValue<AutonomyIssueProjection>(
        runtime.scopeId,
        AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      ).value,
    );
    const operationLabel = moduleOperationLabel(payload.operation);
    for (const issue of projection.issues) {
      if (
        issue.status === "resolved" ||
        issue.source.module !== payload.module ||
        !issue.labels.includes(operationLabel)
      ) {
        continue;
      }
      emitHealth(ctx, runtime.scopeId, {
        observation: "cleared",
        source: issue.source,
        severity: issue.severity,
        labels: issue.labels,
        summary: `${payload.module} operation ${payload.operation} recovered at its owning boundary.`,
        evidenceRefs: [{
          kind: "module-log",
          ref: `.kota/modules/${payload.module}/logs.jsonl`,
        }],
        actionability: issue.actionability,
        dedupeKey: issue.rootCauseKey,
        observationCount: 1,
        createdAt: payload.observedAt,
      });
    }
  });
}
