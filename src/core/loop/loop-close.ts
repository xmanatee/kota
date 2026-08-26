import { tryEmit } from "#core/events/event-bus.js";
import { unregisterSessionEnvironment } from "#core/tools/session-environment.js";
import type { AgentLoopState } from "./loop-init.js";

export async function runClose(state: AgentLoopState, errored: boolean): Promise<void> {
  if (state.closed) return;
  for (const controller of state.activeAbortControllers) {
    if (!controller.signal.aborted) controller.abort(new Error("Session closed"));
  }
  state.closed = true;
  await unregisterSessionEnvironment({
    sessionId: state.sessionId,
    scopeId: state.scopeId,
  });
  if (errored && state.stateMachine.canTransition("error")) {
    state.stateMachine.transition("error");
  }
  if (state.stateMachine.canTransition("closed")) {
    state.stateMachine.transition("closed");
  }
  if (state.sessionPath) state.context.save(state.sessionPath);
  (state as AgentLoopState & { saveToHistory: () => void }).saveToHistory();
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
  if (state.ownsModuleRuntime) {
    await state.moduleLoader.unloadAll();
  }
  await state.mcpManager?.close();
}
