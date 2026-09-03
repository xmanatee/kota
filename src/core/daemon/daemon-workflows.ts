import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { DaemonRuntimeContext } from "./daemon-init.js";

export function listDaemonWorkflowRuntimes(
  ctx: DaemonRuntimeContext,
): readonly WorkflowRuntime[] {
  return ctx.scopeRuntimes.list().map((runtime) => runtime.workflowRuntime);
}

export function validateDaemonWorkflowRuntimes(ctx: DaemonRuntimeContext): void {
  for (const workflows of listDaemonWorkflowRuntimes(ctx)) {
    workflows.validateDefinitions();
  }
}

export async function startDaemonWorkflowRuntimes(ctx: DaemonRuntimeContext): Promise<void> {
  await ctx.scopeRuntimeHost.startInitial(ctx.scopeRuntimes, "prepared");
  for (const runtime of ctx.scopeRuntimes.list()) {
    if (!(await ctx.scopeOnboarding.recoverForStartup(runtime.scope.scopeId))) {
      ctx.scopeLifecycle.restorePreparedScope(runtime.scope.scopeId);
    } else {
      // Refreshing a previously succeeded onboarding operation may activate
      // its prepared runtime while reconciling readiness. Keep startup
      // idempotent across that recovery path.
      if (ctx.scopeLifecycle.getHostingState(runtime.scope.scopeId) !== "hosted") {
        await ctx.scopeRuntimeHost.activatePrepared(
          runtime,
          ctx.startupDispatchPaused ? "paused" : "active",
        );
      }
      if (ctx.scopeOnboarding.isActivationAllowed(runtime.scope.scopeId)) {
        // Succeeded onboarding can publish only after its workflow subscriptions are active.
        await ctx.scopeOnboarding.recoverForStartup(runtime.scope.scopeId);
      }
    }
  }
}

export async function stopDaemonWorkflowRuntimes(
  ctx: DaemonRuntimeContext,
  ...stopArgs: [number] | [number, number]
): Promise<void> {
  if (stopArgs.length === 1) {
    await ctx.scopeRuntimeHost.stopAll(ctx.scopeRuntimes, stopArgs[0]);
  } else {
    await ctx.scopeRuntimeHost.stopAll(ctx.scopeRuntimes, stopArgs[0], stopArgs[1]);
  }
}

export function anyDaemonWorkflowRuntimeBusy(ctx: DaemonRuntimeContext): boolean {
  return listDaemonWorkflowRuntimes(ctx).some((workflows) => workflows.isBusy());
}

export function setDaemonWorkflowDispatchPaused(
  ctx: DaemonRuntimeContext,
  paused: boolean,
): void {
  for (const workflows of listDaemonWorkflowRuntimes(ctx)) {
    workflows.setDispatchPaused(paused);
  }
}
