import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { resolveAgentRunDir } from "./agent-run-dir.js";
import { executeRepairAgentIteration } from "./repair-loop-agent-iteration.js";
import {
  type RepairCheckResult,
  runChecksPhased,
} from "./repair-loop-checks.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import {
  AgentWriteScopeViolationError,
  diffMutatedPaths,
  findWriteScopeViolations,
  listWorkflowMutatedPaths,
  tryListWorkflowMutatedPaths,
  writeWriteScopeViolationArtifact,
} from "./steps/agent-write-scope.js";
import type { AgentStepConfig, AgentStepResult } from "./steps/step-executor-agent.js";
import { writeAgentTokenBudgetArtifact } from "./steps/step-executor-agent-token-budget.js";
import { writeAgentTrajectoryDiagnosticsArtifact } from "./steps/step-executor-agent-trajectory-diagnostics.js";

export type { RepairCheckResult } from "./repair-loop-checks.js";

export type RepairIteration = {
  attempt: number;
  failures: RepairCheckResult[];
  agentResponse?: string;
  agentTurns?: number;
  agentCostUsd?: number;
};

type ScopedRepairAgent = {
  agentName: string;
  writeScope: readonly string[];
};

const REPAIR_NO_PROGRESS_LIMIT = 3;
const MIN_MARKDOWN_FENCE_LENGTH = 3;

type RepairProgressSnapshot = {
  key: string;
  failureIds: string[];
};

function maxBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function markdownFenceForContent(value: string): string {
  return "`".repeat(Math.max(MIN_MARKDOWN_FENCE_LENGTH, maxBacktickRun(value) + 1));
}

function renderFailureOutput(failure: RepairCheckResult): string[] {
  const output = failure.output.trim();
  const fence = markdownFenceForContent(output);
  return [
    `## ${failure.id}`,
    '<untrusted-content source="repair-check.output">',
    fence,
    output,
    fence,
    "</untrusted-content>",
    "",
  ];
}

export function buildRepairPrompt(
  attempt: number,
  maxRepairAttempts: number | undefined,
  failures: RepairCheckResult[],
  step: WorkflowAgentStep,
  runDirPath?: string,
): string {
  const attemptLabel = maxRepairAttempts === undefined
    ? `${attempt}`
    : `${attempt}/${maxRepairAttempts}`;
  const lines = [
    `Post-check repair attempt ${attemptLabel} for step "${step.id}".`,
    "",
    "The following checks failed after your previous work:",
    "",
  ];
  for (const failure of failures) {
    lines.push(...renderFailureOutput(failure));
  }
  if (runDirPath) {
    lines.push("Run directory:", runDirPath, "");
  }
  lines.push(
    "Fix these issues now. Stage all changes with `git add -A` before stopping —",
    "review checks evaluate the staged diff, so unstaged fixes are invisible.",
    "Write a short commit message to `<run-directory>/commit-message.txt` summarizing what changed.",
    "Finish this repair fully, then stop.",
  );
  return lines.join("\n");
}

function gitDiffAgainstHead(workspaceDir: string): string {
  try {
    return execFileSync("git", ["diff", "--binary", "HEAD", "--"], {
      cwd: workspaceDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `git diff unavailable: ${message}`;
  }
}

function repairFailureSignature(failures: RepairCheckResult[]): string {
  return failures
    .map((failure) => `${failure.id}\n${failure.output.trim()}`)
    .join("\n---\n");
}

function repairProgressSnapshot(
  workspaceDir: string,
  failures: RepairCheckResult[],
): RepairProgressSnapshot {
  const status = getRepoWorktreeStatus(workspaceDir);
  const diff = status.available ? gitDiffAgainstHead(workspaceDir) : "";
  const hash = createHash("sha256");
  hash.update(repairFailureSignature(failures));
  hash.update("\0");
  hash.update(status.headSha);
  hash.update("\0");
  hash.update(status.fingerprint);
  hash.update("\0");
  hash.update(diff);
  return {
    key: hash.digest("hex"),
    failureIds: failures.map((failure) => failure.id),
  };
}

function resolveScopedRepairAgent(
  step: WorkflowAgentStep,
  agentConfig: AgentStepConfig,
): ScopedRepairAgent | undefined {
  if (!step.agentName || !agentConfig.resolveAgentDef) return undefined;
  const agentDef = agentConfig.resolveAgentDef(step.agentName);
  if (!agentDef) return undefined;
  return {
    agentName: step.agentName,
    writeScope: agentDef.writeScope,
  };
}

export async function runAgentRepairLoop(
  step: WorkflowAgentStep,
  initialResult: AgentStepResult,
  context: WorkflowStepContext,
  metadata: WorkflowRunMetadata,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
): Promise<AgentStepResult> {
  const { checks, maxRepairAttempts } = step.repairLoop!;
  const iterations: RepairIteration[] = [];
  const base = (initialResult.output && typeof initialResult.output === "object") ? initialResult.output as Record<string, unknown> : {};
  let totalTurns = typeof base.turns === "number" ? base.turns : 0;
  let totalCostUsd = typeof base.totalCostUsd === "number" ? base.totalCostUsd : 0;
  let lastContent = typeof base.content === "string" ? base.content : "";
  let warnings = [] as RepairCheckResult[];
  const trajectoryMessages = [...initialResult.trajectoryMessages];
  const resolvedHarness = resolveAgentHarness(step.harness);
  const scopedAgent = resolveScopedRepairAgent(step, agentConfig);
  const workspaceDir = context.workspaceDir ?? context.projectDir;
  const agentRunDir = resolveAgentRunDir({
    metadata,
    projectDir: context.projectDir,
    runtimeResources: context.runtimeResources,
  });

  const wrap = (output: Record<string, unknown>): AgentStepResult => {
    const postStepMutatedPaths = scopedAgent
      ? listWorkflowMutatedPaths(workspaceDir)
      : (tryListWorkflowMutatedPaths(workspaceDir) ?? []);
    const changedFiles = diffMutatedPaths(
      initialResult.preStepMutatedPaths,
      postStepMutatedPaths,
    );
    const trajectoryDiagnostics = writeAgentTrajectoryDiagnosticsArtifact({
      stepId: step.id,
      runDir: context.workflow.runDir,
      projectDir: context.projectDir,
      harness: resolvedHarness,
      messages: trajectoryMessages,
      changedFiles,
    });
    if (scopedAgent) {
      const violations = findWriteScopeViolations(
        changedFiles,
        scopedAgent.writeScope,
      );
      if (violations.length > 0) {
        const violationCtx = {
          stepId: step.id,
          agentName: scopedAgent.agentName,
          scope: scopedAgent.writeScope,
          violations,
        };
        writeWriteScopeViolationArtifact({
          ...violationCtx,
          metadata,
          projectDir: context.projectDir,
        });
        throw new AgentWriteScopeViolationError(violationCtx);
      }
    }
    return {
      output,
      harness: initialResult.harness,
      model: initialResult.model,
      trajectoryDiagnostics,
      trajectoryMessages,
      preStepMutatedPaths: initialResult.preStepMutatedPaths,
    };
  };

  if (abortController.signal.aborted) {
    return wrap({ ...base, content: lastContent, turns: totalTurns, totalCostUsd, repairIterations: iterations, repairWarnings: warnings });
  }

  const { failures: initialFailures, warnings: initialWarnings } = await runChecksPhased(checks, context, step);
  let failures = initialFailures;
  warnings = initialWarnings;
  let previousProgress = repairProgressSnapshot(workspaceDir, failures);
  let noProgressAttempts = 0;

  for (let attempt = 1; failures.length > 0 && (maxRepairAttempts === undefined || attempt <= maxRepairAttempts); attempt++) {
    if (abortController.signal.aborted) break;

    const iteration: RepairIteration = { attempt, failures };

    const repairPrompt = buildRepairPrompt(attempt, maxRepairAttempts, failures, step, agentRunDir);
    const appendRepairMessage = (message: KotaAgentMessage) => {
      trajectoryMessages.push(message);
      appendMessage(message);
    };
    let repairResult: { text: string; turns?: number; totalCostUsd?: number };
    try {
      repairResult = await executeRepairAgentIteration(
        step,
        repairPrompt,
        context,
        abortController,
        appendRepairMessage,
        agentConfig,
        initialResult.tokenBudget,
      );
    } finally {
      writeAgentTokenBudgetArtifact(
        step.id,
        metadata,
        context.projectDir,
        initialResult.tokenBudget,
      );
    }

    iteration.agentResponse = repairResult.text;
    iteration.agentTurns = repairResult.turns;
    iteration.agentCostUsd = repairResult.totalCostUsd;
    iterations.push(iteration);

    lastContent = repairResult.text;
    totalTurns += repairResult.turns ?? 0;
    totalCostUsd += repairResult.totalCostUsd ?? 0;

    if (abortController.signal.aborted) break;

    const phased = await runChecksPhased(checks, context, step);
    failures = phased.failures;
    warnings = phased.warnings;

    if (failures.length > 0) {
      const progress = repairProgressSnapshot(workspaceDir, failures);
      if (progress.key === previousProgress.key) {
        noProgressAttempts += 1;
      } else {
        previousProgress = progress;
        noProgressAttempts = 0;
      }
      if (noProgressAttempts >= REPAIR_NO_PROGRESS_LIMIT) {
        throw new Error(
          `Repair loop for step "${step.id}" made no progress after ${REPAIR_NO_PROGRESS_LIMIT} consecutive attempts. ` +
            `Still failing: ${progress.failureIds.join(", ")}`,
        );
      }
    }

    if (failures.length > 0 && attempt === maxRepairAttempts) {
      throw new Error(
        `Repair loop for step "${step.id}" exhausted repair attempts (${maxRepairAttempts}). ` +
          `Still failing: ${failures.map((f) => f.id).join(", ")}`,
      );
    }
  }

  return wrap({
    ...base,
    content: lastContent,
    turns: totalTurns,
    totalCostUsd,
    repairIterations: iterations,
    repairWarnings: warnings,
  });
}
