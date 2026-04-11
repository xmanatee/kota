import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { runCheck, stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";

export const agent: AgentDef = {
  name: "decomposer",
  role: "Decompose oversized tasks that caused builder timeouts into smaller, builder-scoped subtasks.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

/** Minimum build-step duration (ms) to consider a failure timeout-shaped. */
const TIMEOUT_THRESHOLD_MS = 45 * 60 * 1000;

export type DecomposerAssessment = {
  shouldDecompose: boolean;
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  taskId: string | null;
  taskPath: string | null;
  isTimeout: boolean;
};

function findTaskInState(projectDir: string, state: string): { id: string; path: string } | null {
  const dir = join(projectDir, "data", "tasks", state);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const taskFile = entries.find((f) => f.startsWith("task-") && f.endsWith(".md"));
  if (!taskFile) return null;
  const id = taskFile.replace(/\.md$/, "");
  return { id, path: join("data", "tasks", state, taskFile) };
}

function isTimeoutShaped(metadata: WorkflowRunMetadata): boolean {
  const buildStep = metadata.steps.find((s) => s.id === "build");
  if (!buildStep || buildStep.status !== "failed") return false;

  if (buildStep.durationMs >= TIMEOUT_THRESHOLD_MS) return true;

  const errorPath = join(metadata.runDir, "error.txt");
  const stepError = buildStep.error ?? "";
  if (/time.?out|timed.?out|deadline.?exceeded/i.test(stepError)) return true;

  try {
    const errorTxt = readFileSync(errorPath, "utf-8");
    if (/time.?out|timed.?out|deadline.?exceeded/i.test(errorTxt)) return true;
  } catch {
    // no error.txt
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
    return {
      shouldDecompose: false,
      reason: "Trigger payload missing runDir or runId",
      failedRunId: runId ?? "",
      failedRunDir: runDir ?? "",
      taskId: null,
      taskPath: null,
      isTimeout: false,
    };
  }

  const metadataPath = join(projectDir, runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: runId,
      failedRunDir: runDir,
      taskId: null,
      taskPath: null,
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
      taskId: null,
      taskPath: null,
      isTimeout: false,
    };
  }

  // Find the task that was being worked on. Builder moves the task to doing/
  // before working on it. If the builder timed out mid-work, the task is
  // likely still in doing/ or was moved to blocked/.
  const doingTask = findTaskInState(projectDir, "doing");
  const blockedTask = doingTask ? null : findTaskInState(projectDir, "blocked");
  const task = doingTask ?? blockedTask;

  if (!task) {
    return {
      shouldDecompose: false,
      reason: "No task found in doing/ or blocked/ to decompose",
      failedRunId: runId,
      failedRunDir: runDir,
      taskId: null,
      taskPath: null,
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
  run: ({ projectDir, trigger }) => buildAssessment(projectDir, trigger.payload),
});

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description:
    "Decompose oversized tasks that caused builder timeouts into smaller, builder-scoped subtasks.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: ["builder"],
        status: ["failed"],
      },
    },
  ],
  steps: [
    assessFailure,
    {
      id: "decompose",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      timeoutMs: 30 * 60 * 1000,
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => assessFailure.output(ctx).shouldDecompose,
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) =>
              runCheck("pnpm run validate-tasks", ctx.projectDir),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("decompose"),
      run: ({ projectDir, workflow }: WorkflowStepContext) =>
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
