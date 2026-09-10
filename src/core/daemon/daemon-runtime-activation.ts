import { realpathSync } from "node:fs";
import {
  affectsLoadedRuntime,
  canonicalRuntimeRevision,
  LOADED_RUNTIME,
  runtimeRevisionContains,
} from "./daemon-runtime-revision.js";
import type { DaemonState } from "./daemon-state.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";

export function runtimeActivationRetryBlocked(
  previous: DaemonState["runtimeRevision"],
  candidate: typeof LOADED_RUNTIME,
): boolean {
  if (previous?.root !== candidate.root || previous.activation?.status !== "failed") return false;
  return candidate.loadedRevision === null
    || runtimeRevisionContains(candidate.root, previous.loadedRevision, candidate.loadedRevision);
}

export function initializeRuntimeActivation(state: DaemonState, stateDir: string): void {
  const previous = state.runtimeRevision;
  if (runtimeActivationRetryBlocked(previous, LOADED_RUNTIME)) {
    throw new Error(previous?.activation?.error ?? "Runtime activation failed; install a changed runtime before retrying.");
  }
  const activation = previous?.root === LOADED_RUNTIME.root ? previous.activation : null;
  state.runtimeRevision = {
    ...LOADED_RUNTIME,
    canonicalRevision: canonicalRuntimeRevision(LOADED_RUNTIME.root),
    activation: activation === null ? null : {
      ...activation,
      // Activation is evidence about this process, not a prior process's readiness.
      status: "starting",
    },
  };
  saveDaemonStateToDisk(stateDir, state);
  const runtime = state.runtimeRevision;
  if (runtime.activation?.status === "starting" && !runtimeRevisionContains(runtime.root, runtime.loadedRevision, runtime.activation.targetRevision)) {
    const error = "Restart did not load the requested runtime revision; rebuild the installed runtime before retrying.";
    failRuntimeActivation(state, stateDir, error);
    throw new Error(error);
  }
}

export function observeIntegratedRuntime(
  state: DaemonState,
  stateDir: string,
  scopeRoot: string,
  integration: { publishedHead: string; changedPaths: readonly string[] },
): boolean {
  const runtime = state.runtimeRevision;
  if (runtime === undefined || realpathSync(scopeRoot) !== runtime.root) return false;
  runtime.canonicalRevision = canonicalRuntimeRevision(runtime.root);
  if (!integration.changedPaths.some(affectsLoadedRuntime)) {
    saveDaemonStateToDisk(stateDir, state);
    return false;
  }
  if (runtimeRevisionContains(runtime.root, runtime.loadedRevision, integration.publishedHead)) {
    return false;
  }
  // Outbox replay and the same failed target must never form a restart loop.
  if (runtime.activation?.targetRevision === integration.publishedHead) return false;
  if (runtime.activation !== null && runtimeRevisionContains(runtime.root, runtime.activation.targetRevision, integration.publishedHead)) return false;
  const previousActivation = runtime.activation;
  runtime.activation = {
    targetRevision: integration.publishedHead,
    status: "draining",
    error: null,
  };
  try {
    saveDaemonStateToDisk(stateDir, state);
  } catch (error) {
    runtime.activation = previousActivation;
    throw error;
  }
  return true;
}

export function completeRuntimeActivation(state: DaemonState, stateDir: string): void {
  const runtime = state.runtimeRevision;
  if (runtime?.activation?.status !== "starting") return;
  runtime.activation.status = "active";
  runtime.activation.error = null;
  saveDaemonStateToDisk(stateDir, state);
}

export function failRuntimeActivation(state: DaemonState, stateDir: string, reason: string): void {
  const activation = state.runtimeRevision?.activation;
  if (activation === undefined || activation === null || activation.status === "active" || activation.status === "failed") return;
  activation.status = "failed";
  activation.error = reason;
  saveDaemonStateToDisk(stateDir, state);
}
