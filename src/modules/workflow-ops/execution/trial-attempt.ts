import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { ensureDir, formatRunId, writeJsonFile } from "#core/workflow/run-io.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import type {
  WorkflowTrialAttemptReport,
  WorkflowTrialBlockedSideEffect,
  WorkflowTrialEvent,
} from "../client.js";
import {
	assertIsolatedTrialWorkspace,
  cloneTrialChangedFile,
  copyScopeToTrialWorkspace,
  diffTrialSnapshots,
  isTrialStoreMutation,
  isTrialTaskMutation,
  safeTrialSegment,
  snapshotTrialFiles,
} from "./trial-files.js";
import type {
  QueuedWorkflowReport,
  TrialVariant,
  WorkflowTrialRuntime,
  WorkflowTrialRuntimeFactory,
} from "./trial-internal-types.js";
import { WorkflowTrialRequestError } from "./trial-internal-types.js";
import { projectTrialPayload } from "./trial-options.js";
import { createTrialAgentToolGuard, runTrialTool } from "./trial-tool-policy.js";

function stepStatuses(
  meta: WorkflowRunMetadata | undefined,
): WorkflowTrialAttemptReport["stepStatuses"] {
  return (meta?.steps ?? []).map((step) => ({
    id: step.id,
    type: step.type,
    status: step.status,
    durationMs: step.durationMs,
  }));
}

function initializeTrialRepository(workspaceRoot: string): void {
  const env = withProtectedGitBareRepositoryEnv();
  const run = (args: string[]) => execFileSync("git", args, {
    cwd: workspaceRoot,
    env,
    stdio: "ignore",
  });
  run(["init", "--quiet"]);
  run(["add", "--all"]);
  run([
    "-c",
    "user.name=KOTA Trial",
    "-c",
    "user.email=kota-trial@localhost",
    "commit",
    "--quiet",
    "--message",
    "trial baseline",
  ]);
  writeFileSync(
    join(workspaceRoot, ".git", "info", "exclude"),
    [".kota/", ""].join("\n"),
    "utf8",
  );
}

export async function runTrialAttempt(args: {
  sourceScopeRoot: string;
  reportDirPath: string;
  variant: TrialVariant;
  repeatIndex: number;
  runtimeFactory: WorkflowTrialRuntimeFactory;
}): Promise<WorkflowTrialAttemptReport> {
  const attemptId = `${safeTrialSegment(args.variant.label)}-${args.repeatIndex + 1}`;
  const trialWorkspaceRoot = copyScopeToTrialWorkspace(args.sourceScopeRoot, attemptId);
  initializeTrialRepository(trialWorkspaceRoot);
	assertIsolatedTrialWorkspace(args.sourceScopeRoot, trialWorkspaceRoot);
  const before = snapshotTrialFiles(trialWorkspaceRoot);
  const attemptReportPath = join(args.reportDirPath, "attempts", `${attemptId}.json`);
  ensureDir(join(args.reportDirPath, "attempts"));

  let runtime: WorkflowTrialRuntime | undefined;
  let host: StandaloneRunHost | undefined;
  const stateDir = mkdtempSync(join(tmpdir(), "kota-workflow-trial-state-"));
  const busEvents: WorkflowTrialEvent[] = [];
  const queuedWorkflows: QueuedWorkflowReport[] = [];
  let metadata: WorkflowRunMetadata | undefined;
  const blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[] = [];
  let error: string | undefined;

  try {
    runtime = await args.runtimeFactory(trialWorkspaceRoot, args.sourceScopeRoot);
    const definition = runtime.workflows.find((item) => item.name === args.variant.workflow);
    if (!definition) {
      throw new WorkflowTrialRequestError(
        `Workflow "${args.variant.workflow}" not found`,
        "unknown_workflow",
      );
    }
    const bus = runtime.eventBus ?? new EventBus();
    bus.on("*", (event) => {
      busEvents.push({
        type: event.type,
        schemaRef: event.schemaRef,
        payload: projectTrialPayload(event.payload),
      });
    });
    const runId = formatRunId(`${args.variant.workflow}-trial`);
    const scopeId = deriveDirectoryScopeId(trialWorkspaceRoot);
    host = new StandaloneRunHost({
      stateDir,
      scope: {
        scopeId,
        scopeRoot: trialWorkspaceRoot,
        displayName: scopeId,
      },
      bus,
      providerRegistry: runtime.providerRegistry,
      workflows: runtime.workflows,
      config: runtime.config,
      resolveAgentDef: runtime.resolveAgentDef,
      resolveSkillsPrompt: runtime.resolveSkillsPrompt,
      execution: (context) => ({
        runTool: (name, input, toolContext) => runTrialTool(
          {
            trialWorkspaceRoot: context.sandbox.workspaceDir,
            stepId: toolContext?.stepId ?? "unknown",
            blockedExternalSideEffects,
          },
          name,
          input,
        ),
        createAgentCanUseTool: (stepId) => createTrialAgentToolGuard({
          trialWorkspaceRoot: context.sandbox.workspaceDir,
          stepId,
          blockedExternalSideEffects,
        }),
      }),
    });
    const result = await host.runToTerminal(definition.name, {
      runId,
      event: "manual",
      payload: args.variant.payload,
    });
    metadata = result.metadata ?? undefined;
    queuedWorkflows.push(...host.listNestedRuns().map((child) => ({
      workflow: child.workflow,
      runId: child.runId,
      waitFor: child.waitFor,
      payload: projectTrialPayload(child.payload),
      status: child.status,
    })));
    if (result.run.state !== "succeeded") {
      const failedStep = metadata?.steps.find((step) => step.status === "failed");
      error = failedStep?.error ?? result.run.lastError
        ?? `workflow finished with state ${result.run.state}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await host?.close();
    await runtime?.unload?.();
    rmSync(stateDir, { force: true, recursive: true });
  }

  const after = snapshotTrialFiles(trialWorkspaceRoot);
  const changedFiles = diffTrialSnapshots(before, after);
  const status: WorkflowTrialAttemptReport["status"] = blockedExternalSideEffects.length > 0
    ? "blocked"
    : error
      ? "failed"
      : "passed";
  const report: WorkflowTrialAttemptReport = {
    id: attemptId,
    workflow: args.variant.workflow,
    payload: projectTrialPayload(args.variant.payload),
    status,
    trialWorkspaceRoot: trialWorkspaceRoot,
    ...(metadata?.id !== undefined && { workflowRunId: metadata.id }),
    stepStatuses: stepStatuses(metadata),
    changedFiles,
    taskMutations: changedFiles.filter(isTrialTaskMutation).map(cloneTrialChangedFile),
    storeMutations: changedFiles.filter(isTrialStoreMutation).map(cloneTrialChangedFile),
    busEvents,
    queuedWorkflows,
    blockedExternalSideEffects,
    reportPath: relative(args.sourceScopeRoot, attemptReportPath),
    ...(error !== undefined && { error }),
  };
  writeJsonFile(attemptReportPath, report);
  return report;
}
