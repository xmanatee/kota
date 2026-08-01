import { JsonFileError } from "#core/util/json-file.js";
import type { ProjectRuntime } from "./project-runtime.js";
import { resolveLiveDirectoryScope } from "./scope-directory.js";
import {
  type DirectoryScopeRegistrationInput,
  errorMessage,
  registeredDirectoryScope,
  type ScopeLifecycleOptions,
  type ScopeRegistrationResult,
} from "./scope-lifecycle-types.js";

export async function registerDirectoryScope(
  options: ScopeLifecycleOptions,
  input: DirectoryScopeRegistrationInput,
): Promise<ScopeRegistrationResult> {
  if (!options.runtimeHost.isActive()) {
    return {
      ok: false,
      reason: "daemon_not_running",
      message: "Directory scopes can only be registered while the daemon is running",
    };
  }
  const resolved = resolveLiveDirectoryScope({
    projectDir: input.directoryRoot,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, message: resolved.message };
  }
  const project = resolved.project;
  const existing = options.registry.getByDir(project.projectDir)
    ?? options.registry.get(project.projectId);
  if (existing) {
    return {
      ok: false,
      reason: "duplicate_scope",
      message: `Directory scope ${existing.projectId} is already registered`,
      scopeId: existing.projectId,
      existing: registeredDirectoryScope(
        existing.projectId,
        existing.projectDir,
        existing.displayName,
      ),
    };
  }

  let runtime: ProjectRuntime;
  try {
    runtime = options.runtimes.createDetached(project);
  } catch (error) {
    return {
      ok: false,
      reason: "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: project.projectId,
    };
  }

  try {
    // Commit the durable authority before activation. Even paused workflow
    // startup performs recovery writes, so it cannot be used as a preflight.
    options.registry.add(project);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof JsonFileError ? "persistence_failed" : "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: project.projectId,
    };
  }

  let runtimeAdded = false;
  try {
    options.runtimes.add(runtime);
    runtimeAdded = true;
    await options.runtimeHost.start(runtime, "paused");
  } catch (error) {
    const rollbackFailure = await rollbackCommittedRegistration(options, runtime, runtimeAdded);
    if (rollbackFailure !== null) {
      return {
        ok: false,
        reason: "rollback_failed",
        message: `${errorMessage(error as Error)}; rollback failed: ${rollbackFailure}`,
        scopeId: project.projectId,
      };
    }
    return {
      ok: false,
      reason: "runtime_start_failed",
      message: errorMessage(error as Error),
      scopeId: project.projectId,
    };
  }

  runtime.workflowRuntime.setDispatchPaused(false);

  options.bus.emit("scope.lifecycle.changed", {
    transition: "registered",
    affectedScopeId: project.projectId,
    directoryRoot: project.projectDir,
    displayName: project.displayName,
  });
  return {
    ok: true,
    status: "registered",
    scope: registeredDirectoryScope(
      project.projectId,
      project.projectDir,
      project.displayName,
    ),
  };
}

async function rollbackCommittedRegistration(
  options: ScopeLifecycleOptions,
  runtime: ProjectRuntime,
  runtimeAdded: boolean,
): Promise<string | null> {
  const failures: string[] = [];
  runtime.workflowRuntime.setDispatchPaused(true);
  try {
    await options.runtimeHost.abortUncommitted(runtime, 1, 1_000);
  } catch (error) {
    failures.push(`runtime stop: ${errorMessage(error as Error)}`);
  }
  if (runtimeAdded) {
    try {
      options.runtimes.remove(runtime.project.projectId);
    } catch (error) {
      failures.push(`runtime registry: ${errorMessage(error as Error)}`);
    }
  }
  try {
    options.registry.remove(runtime.project.projectId);
  } catch (error) {
    failures.push(`scope registry: ${errorMessage(error as Error)}`);
  }
  return failures.length === 0 ? null : failures.join("; ");
}
