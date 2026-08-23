import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";
import { emitHealth } from "./autonomy-issue-source-shared.js";

type BuilderInterruptionSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

export function subscribeBuilderInterruptions(
  ctx: BuilderInterruptionSourceContext,
): void {
  ctx.events.subscribe("workflow.interrupted.alert", (payload) => {
    if (payload.workflow !== "builder") return;
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    const run = runtime.runStore.getRun(payload.runId);
    if (run === null || run.status !== "interrupted") {
      throw new Error(
        `Builder interruption ${payload.runId} has no interrupted run in scope ` +
          runtime.scopeId,
      );
    }
    emitHealth(ctx, runtime.scopeId, {
      observation: "present",
      source: { kind: "workflow", id: "builder", workflow: "builder" },
      severity: "critical",
      labels: ["builder", "interrupted-run", "runtime"],
      summary:
        "Builder interruption requires a scoped recovery or root-cause disposition.",
      evidenceRefs: [{
        kind: "run",
        ref: `.kota/runs/${payload.runId}/metadata.json`,
      }],
      actionability: "local-code",
      dedupeKey: "workflow:builder:interrupted-run",
      observationCount: 1,
      createdAt: run.completedAt ?? new Date().toISOString(),
    });
  });
}
