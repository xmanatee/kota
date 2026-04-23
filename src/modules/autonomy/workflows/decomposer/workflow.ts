import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";

export const agent: AgentDef = {
  name: "decomposer",
  role: "Decompose builder-timeout tasks into coherent task sequences.",
  promptPath: "src/modules/autonomy/workflows/decomposer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  tools: { permissionMode: "bypassPermissions" },
  writeScope: ["data/tasks/"],
  settingSources: ["project"],
};

const TIMEOUT_THRESHOLD_MS = AUTONOMY_AGENT_HANG_TIMEOUT_MS;

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  isTimeout: boolean;
} & (
  | { shouldDecompose: false }
  | { shouldDecompose: true; taskId: string; taskPath: string }
);

const TASK_STATES_FOR_IDENTIFIED_TASK = ["doing", "blocked", "ready"] as const;

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

function findTaskById(
  projectDir: string,
  taskId: string,
): { id: string; path: string } | null {
  for (const state of TASK_STATES_FOR_IDENTIFIED_TASK) {
    const candidate = join(projectDir, "data", "tasks", state, `${taskId}.md`);
    if (existsSync(candidate)) {
      return { id: taskId, path: join("data", "tasks", state, `${taskId}.md`) };
    }
  }
  return null;
}

// Pre-stash rename signal in the recovery payload's worktreeSummary:
// "R  data/tasks/ready/task-X.md -> data/tasks/doing/task-X.md, ...".
// The rename is reverted by the stash that runs before assess-failure, so the
// task file lives back in ready/ — we extract the id from the summary itself.
function extractTaskIdFromWorktreeSummary(summary: string): string | null {
  const match = /data\/tasks\/(?:doing|blocked)\/(task-[a-z0-9-]+)\.md/i.exec(summary);
  return match ? match[1] : null;
}

type ResolvedSource = {
  runId: string;
  runDir: string;
  /** When present, pre-stash worktree rename signal used to identify the failed task. */
  worktreeSummary: string | null;
  /** True when the trigger gives us no usable source context (non-builder recovery). */
  skip: boolean;
};

function resolveSourceRun(
  triggerEvent: string,
  payload: Record<string, unknown>,
): ResolvedSource {
  if (triggerEvent === "runtime.recovered") {
    const sourceWorkflow = payload.sourceWorkflow;
    if (sourceWorkflow !== "builder") {
      return { runId: "", runDir: "", worktreeSummary: null, skip: true };
    }
    const sourceRunId = payload.sourceRunId;
    if (typeof sourceRunId !== "string" || sourceRunId.length === 0) {
      throw new Error(
        "Decomposer recovery trigger payload must include sourceRunId when sourceWorkflow is builder",
      );
    }
    const worktreeSummary =
      typeof payload.worktreeSummary === "string" ? payload.worktreeSummary : null;
    return {
      runId: sourceRunId,
      runDir: join(".kota", "runs", sourceRunId),
      worktreeSummary,
      skip: false,
    };
  }

  const runDir = payload.runDir;
  const runId = payload.runId;
  if (typeof runDir !== "string" || typeof runId !== "string") {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }
  return { runId, runDir, worktreeSummary: null, skip: false };
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
  triggerEvent: string,
  triggerPayload: Record<string, unknown>,
): DecomposerAssessment {
  const source = resolveSourceRun(triggerEvent, triggerPayload);

  if (source.skip) {
    return {
      shouldDecompose: false,
      reason: "Recovery source was not builder — nothing for decomposer to do",
      failedRunId: "",
      failedRunDir: "",
      isTimeout: false,
    };
  }

  const metadataPath = join(projectDir, source.runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      isTimeout: false,
    };
  }

  if (!isTimeoutShaped(metadata)) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not look timeout-shaped",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      isTimeout: false,
    };
  }

  // Recovery path: the failed builder's rename was reverted by the stash step,
  // so the task file is back in ready/. Use the pre-stash worktreeSummary to
  // identify which task, then look it up across task states.
  const task = source.worktreeSummary
    ? (() => {
        const id = extractTaskIdFromWorktreeSummary(source.worktreeSummary);
        return id ? findTaskById(projectDir, id) : null;
      })()
    : findTaskInState(projectDir, "doing");

  if (!task) {
    return {
      shouldDecompose: false,
      reason: source.worktreeSummary
        ? "Could not identify the failed task from the recovery payload worktree summary"
        : "No builder-claimed task found in doing/ to decompose",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      isTimeout: true,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder timed out on ${task.id} — decomposing`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    isTimeout: true,
  };
}

const assessFailure = typedCodeStep<DecomposerAssessment>({
  id: "assess-failure",
  type: "code",
  run: ({ projectDir, trigger }) =>
    buildAssessment(projectDir, trigger.event, trigger.payload),
});

const decomposerWorkflow: WorkflowDefinitionInput = {
  name: "decomposer",
  description:
    "Decompose builder-timeout tasks into coherent task sequences.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
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
      id: "decompose",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => assessFailure.output(ctx).shouldDecompose,
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
