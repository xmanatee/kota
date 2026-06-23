import { tryEmit } from "#core/events/event-bus.js";
import { runCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { resetAgentStatusProviders } from "#core/tools/agent-status.js";
import { resetCustomTools } from "#core/tools/custom-tool.js";
import { resetModuleFactory } from "#core/tools/module-factory/index.js";
import { resetGroups } from "#core/tools/tool-groups.js";
import { resetToolTelemetry } from "#core/tools/tool-telemetry.js";
import { resetChangeTracker } from "./file-changes.js";
import type { AgentLoopState } from "./loop-init.js";

export function runClose(state: AgentLoopState, errored: boolean): void {
  if (state.closed) return;
  for (const controller of state.activeAbortControllers) {
    if (!controller.signal.aborted) controller.abort(new Error("Session closed"));
  }
  state.closed = true;
  if (errored && state.stateMachine.canTransition("error")) {
    state.stateMachine.transition("error");
  }
  if (state.stateMachine.canTransition("closed")) {
    state.stateMachine.transition("closed");
  }
  if (state.sessionPath) state.context.save(state.sessionPath);
  (state as AgentLoopState & { saveToHistory: () => void }).saveToHistory();
  runCleanupHooks();
  resetCustomTools();
  resetModuleFactory();
  resetChangeTracker();
  resetGroups();
  resetProviderRegistry();
  resetToolTelemetry();
  resetAgentStatusProviders();
  state.moduleLoader.unloadAll().catch(() => {});
  state.mcpManager?.close().catch(() => {});
  if (state.sessionStartTime > 0) {
    tryEmit("session.end", {
      sessionId: state.sessionId,
      label: state.sessionLabel,
      error: errored ? "session errored" : undefined,
      durationMs: Date.now() - state.sessionStartTime,
    });
  }
  if (!errored) {
    state.transport.emit({
      type: "status",
      message: `[kota] Done — ${state.costTracker.getSummary()}`,
    });
  }
}
