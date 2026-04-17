import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { recallForDecomposer } from "#modules/autonomy/knowledge-recall.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import { AUTONOMY_DISALLOWED_TOOLS, checkCommitMessageExists, checkNoScratchArtifacts, runCheck, stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";

export const agent: AgentDef = {
  name: "decomposer",
  role: "Decompose builder-timeout tasks into coherent task sequences.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  model: "claude-opus-4-7",
  effort: "xhigh",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

/** Minimum build-step duration (ms) to consider a failure timeout-shaped. */
const TIMEOUT_THRESHOLD_MS = 45 * 60 * 1000;

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  isTimeout: boolean;
} & (
  | { shouldDecompose: false }
  | { shouldDecompose: true; taskId: string; taskPath: string }
);

function findTaskInState(projectDir: string, state: string): { id: string; path: string } | null {
  const dir = join(projectDir, "data", "tasks", state);
  if (!existsSync(dir)) {
    return null;
  }
  const entries = readdirSync(dir);
  const taskFile = entries.find((f) => f.startsWith("task-") && f.endsWith(".md"));
  if (!taskFile) return null;
  const id = taskFile.replace(/\.md$/, "");
  return { id, path: join("data", "tasks", state, taskFile) };
}

function isTimeoutShaped(metadata: WorkflowRunMetadata): boolean {
  const buildStep = metadata.steps.find((s) => s.id === "build");
  if (!buildStep || buildStep.status !== "failed") return false;

  if (buildStep.durationMs >= TIMEOUT_THRESHOLD_MS) return true;

  const stepError = buildStep.error ?? "";
  if (/time.?out|timed.?out|deadline.?exceeded/i.test(stepError)) return true;

  const errorPath = join(metadata.runDir, "error.txt");
  if (existsSync(errorPath)) {
    const errorTxt = readFileSync(errorPath, "utf-8");
    if (/time.?out|timed.?out|deadline.?exceeded/i.test(errorTxt)) return true;
  }

  return false;
}

function buildAssessment(
  projectDir: string,
  triggerPayload: Record<string, unknown>,
): DecomposerAssessment {
  const runDir = triggerPayload.runDir as string | undefined;
  const runId = triggerPayload.runId as string | undefined;

  if (!runDir || !runId) {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }

  const metadataPath = join(projectDir, runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: runId,
      failedRunDir: runDir,
      isTimeout: false,
    };
  }

  const timeout = isTimeoutShaped(metadata);

  if (!timeout) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not look timeout-shaped",
      failedRunId: runId,
      failedRunDir: runDir,
      isTimeout: false,
    };
  }

  const doingTask = findTaskInState(projectDir, "doing");
  const blockedTask = doingTask ? null : findTaskInState(projectDir, "blocked");
  const task = doingTask ?? blockedTask;

  if (!task) {
    return {
      shouldDecompose: false,
      reason: "No task found in doing/ or blocked/ to decompose",
      failedRunId: runId,
      failedRunDir: runDir,
      isTimeout: true,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder timed out on ${task.id} — decomposing`,
    failedRunId: runId,
    failedRunDir: runDir,
    taskId: task.id,
    taskPath: task.path,
    isTimeout: true,
  };
}

const assessFailure = typedCodeStep<DecomposerAssessment>({
  id: "assess-failure",
  type: "code",
  when: onNormalTrigger,
  run: ({ projectDir, trigger }) => buildAssessment(projectDir, trigger.payload),
});

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description:
    "Decompose builder-timeout tasks into coherent task sequences.",
  tags: ["monitored"],
  recoveryCapable: true,
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: ["builder"],
        status: ["failed"],
      },
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "decomposer" }),
    },
    assessFailure,
    {
      id: "recall-knowledge",
      type: "code",
      when: onNormalTrigger,
      exposeOutputToAgent: true,
      run: ({ projectDir }) => recallForDecomposer(projectDir),
    },
    {
      id: "decompose",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        return assessFailure.output(ctx).shouldDecompose;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) =>
              runCheck("pnpm run validate-tasks", ctx.projectDir),
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("decompose"),
      run: ({ projectDir, workflow }) =>
        commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "decomposer committed new subtasks to ready queue",
      requires: ["commit"],
    },
  ],
};

export default decomposerWorkflow;
