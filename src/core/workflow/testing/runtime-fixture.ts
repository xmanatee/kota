import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { RunCoordinator } from "../run-coordinator.js";
import { RunStateDatabase } from "../run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "../runtime.js";

export type TestWorkflowRuntime = Readonly<{
  runtime: WorkflowRuntime;
  runState: RunStateDatabase;
  stop(): Promise<void>;
}>;

export function createTestWorkflowRuntime(
  config: Omit<
    WorkflowRuntimeConfig,
    "projectId" | "runState" | "runCoordinator" | "daemonEpoch"
  > & { projectDir: string; projectId?: string },
  concurrency = 4,
): TestWorkflowRuntime {
  const runState = new RunStateDatabase(join(config.projectDir, ".kota", "state"));
  const projectId =
    config.projectId ??
    config.pbus?.getProjectId() ??
    deriveDirectoryScopeId(config.projectDir);
  const startedAt = new Date().toISOString();
  runState.registerProject({
    id: projectId,
    rootPath: config.projectDir,
    createdAt: startedAt,
  });
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  let runtime!: WorkflowRuntime;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) => runtime.deliverPublication(publication),
  });
  runtime = new WorkflowRuntime({
    ...config,
    pbus: config.pbus ?? new ProjectScopedEventBus(config.bus, projectId),
    projectId,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return {
    runtime,
    runState,
    async stop() {
      await runtime.stop();
      runState.close();
    },
  };
}
