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
	assertIsolatedTrialProjectRoot,
  cloneTrialChangedFile,
  copyProjectForTrial,
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

function initializeTrialRepository(projectDir: string): void {
  const env = withProtectedGitBareRepositoryEnv();
  const run = (args: string[]) => execFileSync("git", args, {
    cwd: projectDir,
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
    join(projectDir, ".git", "info", "exclude"),
    [".kota/", ""].join("\n"),
    "utf8",
  );
}

export async function runTrialAttempt(args: {
  sourceProjectDir: string;
  reportDirPath: string;
  variant: TrialVariant;
  repeatIndex: number;
  runtimeFactory: WorkflowTrialRuntimeFactory;
}): Promise<WorkflowTrialAttemptReport> {
  const attemptId = `${safeTrialSegment(args.variant.label)}-${args.repeatIndex + 1}`;
  const trialProjectDir = copyProjectForTrial(args.sourceProjectDir, attemptId);
  initializeTrialRepository(trialProjectDir);
	assertIsolatedTrialProjectRoot(args.sourceProjectDir, trialProjectDir);
  const before = snapshotTrialFiles(trialProjectDir);
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
    runtime = await args.runtimeFactory(trialProjectDir, args.sourceProjectDir);
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
    const projectId = deriveDirectoryScopeId(trialProjectDir);
    host = new StandaloneRunHost({
      stateDir,
      project: {
        projectId,
        projectDir: trialProjectDir,
        displayName: projectId,
      },
      bus,
      workflows: runtime.workflows,
      config: runtime.config,
      resolveAgentDef: runtime.resolveAgentDef,
      resolveSkillsPrompt: runtime.resolveSkillsPrompt,
      execution: (context) => ({
        runTool: (name, input, toolContext) => runTrialTool(
          {
            trialProjectDir: context.sandbox.workspaceDir,
            stepId: toolContext?.stepId ?? "unknown",
            blockedExternalSideEffects,
          },
          name,
          input,
        ),
        createAgentCanUseTool: (stepId) => createTrialAgentToolGuard({
          trialProjectDir: context.sandbox.workspaceDir,
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

  const after = snapshotTrialFiles(trialProjectDir);
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
    trialProjectPath: trialProjectDir,
    ...(metadata?.id !== undefined && { workflowRunId: metadata.id }),
    stepStatuses: stepStatuses(metadata),
    changedFiles,
    taskMutations: changedFiles.filter(isTrialTaskMutation).map(cloneTrialChangedFile),
    storeMutations: changedFiles.filter(isTrialStoreMutation).map(cloneTrialChangedFile),
    busEvents,
    queuedWorkflows,
    blockedExternalSideEffects,
    reportPath: relative(args.sourceProjectDir, attemptReportPath),
    ...(error !== undefined && { error }),
  };
  writeJsonFile(attemptReportPath, report);
  return report;
}
