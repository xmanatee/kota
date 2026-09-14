import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  moduleOperationHealthPattern,
  moduleOperationRecoveryPattern,
} from "./autonomy-issue-module-failure.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";
import { emitHealth, stableToken } from "./autonomy-issue-source-shared.js";

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
        kind: "event",
        ref: `module.operation.failed:${payload.module}:${payload.operation}:${payload.observedAt}`,
        moduleOperation: { operation: stableToken(payload.operation), observedAt: payload.observedAt, observation: "present" },
      }],
      observationCount: 1,
      createdAt: payload.observedAt,
    });
  });
  ctx.events.subscribe("module.operation.recovered", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    emitHealth(ctx, runtime.scopeId, {
      ...moduleOperationRecoveryPattern(payload.module, payload.operation),
      observation: "cleared",
      evidenceRefs: [{
        kind: "event",
        ref: `module.operation.recovered:${payload.module}:${payload.operation}:${payload.observedAt}`,
        moduleOperation: { operation: stableToken(payload.operation), observedAt: payload.observedAt, observation: "cleared" },
      }],
      observationCount: 1,
      createdAt: payload.observedAt,
    });
  });
}
