import { join, relative } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { executeWorkflowRun, type RunExecutorDeps } from "#core/workflow/run-executor.js";
import { ensureDir, formatRunId, writeJsonFile } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type {
  WorkflowTrialAttemptReport,
  WorkflowTrialBlockedSideEffect,
  WorkflowTrialEvent,
} from "../client.js";
import {
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

export async function runTrialAttempt(args: {
  sourceProjectDir: string;
  reportDirPath: string;
  variant: TrialVariant;
  repeatIndex: number;
  runtimeFactory: WorkflowTrialRuntimeFactory;
}): Promise<WorkflowTrialAttemptReport> {
  const attemptId = `${safeTrialSegment(args.variant.label)}-${args.repeatIndex + 1}`;
  const trialProjectDir = copyProjectForTrial(args.sourceProjectDir, attemptId);
  const before = snapshotTrialFiles(trialProjectDir);
  const attemptReportPath = join(args.reportDirPath, "attempts", `${attemptId}.json`);
  ensureDir(join(args.reportDirPath, "attempts"));

  let runtime: WorkflowTrialRuntime | undefined;
  const busEvents: WorkflowTrialEvent[] = [];
  const queuedWorkflows: QueuedWorkflowReport[] = [];
  let metadata: WorkflowRunMetadata | undefined;
  const blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[] = [];
  let error: string | undefined;

  try {
    runtime = await args.runtimeFactory(trialProjectDir, args.sourceProjectDir);
    const definition = runtime.definitions.find((item) => item.name === args.variant.workflow);
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
    const pbus = runtime.projectRuntime?.pbus
      ?? new ProjectScopedEventBus(bus, deriveDirectoryScopeId(trialProjectDir));
    const store = runtime.projectRuntime?.runStore
      ?? new WorkflowRunStore(trialProjectDir);
    const runId = formatRunId(`${args.variant.workflow}-trial`);
    const trigger: WorkflowRunTrigger = {
      event: "manual",
      schemaRef: null,
      payload: {
        ...args.variant.payload,
        triggeredAt: new Date().toISOString(),
        _runId: runId,
      },
    };

    const triggerWorkflow: NonNullable<RunExecutorDeps["triggerWorkflow"]> = async (
      workflowName,
      payload,
      waitFor,
      signal,
    ) => {
      const childRunId = formatRunId(`${workflowName}-trial-child`);
      const childTrigger: WorkflowRunTrigger = {
        event: "trial.triggered",
        schemaRef: null,
        payload: {
          ...payload,
          triggeredAt: new Date().toISOString(),
          _runId: childRunId,
        },
      };
      if (waitFor === "completed") {
        const childDefinition = runtime!.definitions.find((item) => item.name === workflowName);
        if (!childDefinition) throw new Error(`Triggered workflow "${workflowName}" not found`);
        const childAbortController = new AbortController();
        if (signal) {
          if (signal.aborted) {
            childAbortController.abort(signal.reason);
          } else {
            signal.addEventListener(
              "abort",
              () => childAbortController.abort(signal.reason),
              { once: true },
            );
          }
        }
        const child = executeWorkflowRun(childDefinition, childTrigger, {
          projectDir: trialProjectDir,
          bus,
          pbus,
          store,
          config: runtime!.config,
          log: () => {},
          triggerWorkflow,
          runTool: (name, input, context) => runTrialTool(
            {
              trialProjectDir,
              stepId: context?.stepId ?? "unknown",
              blockedExternalSideEffects,
            },
            name,
            input,
          ),
          createAgentCanUseTool: (stepId) => createTrialAgentToolGuard({
            trialProjectDir,
            stepId,
            blockedExternalSideEffects,
          }),
          resolveAgentDef: runtime!.resolveAgentDef,
          resolveSkillsPrompt: runtime!.resolveSkillsPrompt,
        }, childAbortController);
        const childResult = await child.promise;
        const childStatus = childResult.metadata.status === "success"
          || childResult.metadata.status === "completed-with-warnings"
          ? "completed"
          : "failed";
        queuedWorkflows.push({
          workflow: workflowName,
          runId: childRunId,
          waitFor,
          payload: projectTrialPayload(payload),
          status: childStatus,
        });
        return { runId: childRunId, status: childStatus };
      }

      const state = store.readState();
      const now = Date.now();
      store.setPendingRuns([
        ...state.pendingRuns,
        {
          runId: childRunId,
          workflowName,
          trigger: childTrigger,
          enqueuedAtMs: now,
          notBeforeMs: now,
        },
      ]);
      queuedWorkflows.push({
        workflow: workflowName,
        runId: childRunId,
        waitFor,
        payload: projectTrialPayload(payload),
        status: "queued",
      });
      return { runId: childRunId, status: "queued" };
    };

    const { promise } = executeWorkflowRun(definition, trigger, {
      projectDir: trialProjectDir,
      bus,
      pbus,
      store,
      config: runtime.config,
      log: () => {},
      triggerWorkflow,
      runTool: (name, input, context) => runTrialTool(
        {
          trialProjectDir,
          stepId: context?.stepId ?? "unknown",
          blockedExternalSideEffects,
        },
        name,
        input,
      ),
      createAgentCanUseTool: (stepId) => createTrialAgentToolGuard({
        trialProjectDir,
        stepId,
        blockedExternalSideEffects,
      }),
      resolveAgentDef: runtime.resolveAgentDef,
      resolveSkillsPrompt: runtime.resolveSkillsPrompt,
    });
    const result = await promise;
    metadata = result.metadata;
    if (metadata.status !== "success" && metadata.status !== "completed-with-warnings") {
      const failedStep = metadata.steps.find((step) => step.status === "failed");
      error = failedStep?.error ?? `workflow finished with status ${metadata.status}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await runtime?.unload?.();
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
