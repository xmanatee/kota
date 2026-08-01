import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { DaemonRuntimeContext } from "./daemon-init.js";

export function listDaemonWorkflowRuntimes(
  ctx: DaemonRuntimeContext,
): readonly WorkflowRuntime[] {
  return ctx.projectRuntimes.list().map((runtime) => runtime.workflowRuntime);
}

export function validateDaemonWorkflowRuntimes(ctx: DaemonRuntimeContext): void {
  for (const workflows of listDaemonWorkflowRuntimes(ctx)) {
    workflows.validateDefinitions();
  }
}

export function startDaemonWorkflowRuntimes(ctx: DaemonRuntimeContext): Promise<void> {
  return ctx.scopeRuntimeHost.startInitial(ctx.projectRuntimes);
}

export async function stopDaemonWorkflowRuntimes(
  ctx: DaemonRuntimeContext,
  ...stopArgs: [number] | [number, number]
): Promise<void> {
  if (stopArgs.length === 1) {
    await ctx.scopeRuntimeHost.stopAll(ctx.projectRuntimes, stopArgs[0]);
  } else {
    await ctx.scopeRuntimeHost.stopAll(ctx.projectRuntimes, stopArgs[0], stopArgs[1]);
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
