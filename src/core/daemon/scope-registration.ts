import { JsonFileError } from "#core/util/json-file.js";
import { resolveLiveDirectoryScope } from "./scope-directory.js";
import {
  type DirectoryScopeRegistrationInput,
  errorMessage,
  registeredDirectoryScope,
  type ScopeLifecycleOptions,
  type ScopeRegistrationResult,
} from "./scope-lifecycle-types.js";
import type { ScopeRuntime } from "./scope-runtime.js";

export async function registerDirectoryScope(
  options: ScopeLifecycleOptions,
  input: DirectoryScopeRegistrationInput,
  activate = true,
): Promise<ScopeRegistrationResult> {
  if (!options.runtimeHost.isActive()) {
    return {
      ok: false,
      reason: "daemon_not_running",
      message: "Directory scopes can only be registered while the daemon is running",
    };
  }
  const resolved = resolveLiveDirectoryScope({
    scopeRoot: input.directoryRoot,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, message: resolved.message };
  }
  const scope = resolved.scope;
  const existing = options.registry.getByRoot(scope.scopeRoot)
    ?? options.registry.get(scope.scopeId);
  if (existing) {
    return {
      ok: false,
      reason: "duplicate_scope",
      message: `Directory scope ${existing.scopeId} is already registered`,
      scopeId: existing.scopeId,
      existing: registeredDirectoryScope(
        existing.scopeId,
        existing.scopeRoot,
        existing.displayName,
      ),
    };
  }

  let runtime: ScopeRuntime;
  try {
    runtime = options.runtimes.createDetached(scope);
  } catch (error) {
    return {
      ok: false,
      reason: "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: scope.scopeId,
    };
  }

  try {
    // Commit the durable authority before activation. Even paused workflow
    // startup performs recovery writes, so it cannot be used as a preflight.
    options.registry.add(scope);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof JsonFileError ? "persistence_failed" : "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: scope.scopeId,
    };
  }

  try {
    options.runState.registerScope({
      id: scope.scopeId,
      rootPath: scope.scopeRoot,
      displayName: scope.displayName,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    try {
      options.registry.remove(scope.scopeId);
    } catch (rollbackError) {
      return {
        ok: false,
        reason: "rollback_failed",
        message: `${errorMessage(error as Error)}; rollback failed: ${errorMessage(rollbackError as Error)}`,
        scopeId: scope.scopeId,
      };
    }
    return {
      ok: false,
      reason: "persistence_failed",
      message: errorMessage(error as Error),
      scopeId: scope.scopeId,
    };
  }

  let runtimeAdded = false;
  try {
    options.runtimes.add(runtime);
    runtimeAdded = true;
    await options.runtimeHost.start(runtime, activate ? "active" : "prepared");
  } catch (error) {
    const rollbackFailure = await rollbackCommittedRegistration(options, runtime, runtimeAdded);
    if (rollbackFailure !== null) {
      return {
        ok: false,
        reason: "rollback_failed",
        message: `${errorMessage(error as Error)}; rollback failed: ${rollbackFailure}`,
        scopeId: scope.scopeId,
      };
    }
    return {
      ok: false,
      reason: "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: scope.scopeId,
    };
  }

  if (activate) {
    options.bus.emit("scope.lifecycle.changed", {
      transition: "registered",
      affectedScopeId: scope.scopeId,
      directoryRoot: scope.scopeRoot,
      displayName: scope.displayName,
    });
  }
  return {
    ok: true,
    status: "registered",
    scope: registeredDirectoryScope(
      scope.scopeId,
      scope.scopeRoot,
      scope.displayName,
    ),
  };
}

async function rollbackCommittedRegistration(
  options: ScopeLifecycleOptions,
  runtime: ScopeRuntime,
  runtimeAdded: boolean,
): Promise<string | null> {
  const failures: string[] = [];
  runtime.workflowRuntime.setDispatchPaused(true);
  try {
    await options.runtimeHost.abortUncommitted(runtime, 1, 1_000);
  } catch (error) {
    return `runtime stop: ${errorMessage(error as Error)}`;
  }
  if (runtimeAdded) {
    try {
      options.runtimes.remove(runtime.scope.scopeId);
    } catch (error) {
      return `runtime registry: ${errorMessage(error as Error)}`;
    }
  }
  try {
    options.registry.remove(runtime.scope.scopeId);
  } catch (error) {
    failures.push(`scope registry: ${errorMessage(error as Error)}`);
    if (runtimeAdded) {
      try {
        options.runtimes.add(runtime);
      } catch (restoreError) {
        failures.push(`runtime registry restore: ${errorMessage(restoreError as Error)}`);
      }
    }
    return failures.join("; ");
  }
  try {
    options.runState.removeUnadmittedScope(runtime.scope.scopeId);
  } catch (error) {
    failures.push(`run-state scope: ${errorMessage(error as Error)}`);
    // The run-state deletion is transactional, so a failure leaves its scope
    // row intact. Restore the other canonical projections to the same state.
    try {
      options.registry.add(runtime.scope);
    } catch (restoreError) {
      failures.push(`scope registry restore: ${errorMessage(restoreError as Error)}`);
    }
    if (runtimeAdded) {
      try {
        options.runtimes.add(runtime);
      } catch (restoreError) {
        failures.push(`runtime registry restore: ${errorMessage(restoreError as Error)}`);
      }
    }
  }
  return failures.length === 0 ? null : failures.join("; ");
}
