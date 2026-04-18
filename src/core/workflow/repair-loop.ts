import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  createDaemonHostControlGuard,
  executeWithAgentSDK,
} from "#core/agent-sdk/index.js";
import type { SDKMessage } from "#core/agent-sdk/types.js";
import type { WorkflowRepairCheck, WorkflowStepContext } from "./run-types.js";
import type { AgentStepConfig, WorkflowStepOutput } from "./steps/step-executor-agent.js";
import {
  resolveAgentModel,
  resolvePromptContextStartDir,
} from "./steps/step-executor-agent.js";
import type { WorkflowAgentStep } from "./types.js";

export type RepairCheckResult = {
  id: string;
  passed: boolean;
  output: string;
  severity: "error" | "warning";
};

export type RepairIteration = {
  attempt: number;
  failures: RepairCheckResult[];
  agentResponse?: string;
  agentTurns?: number;
  agentCostUsd?: number;
};

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
    lines.push(`## ${failure.id}`, "```", failure.output.trim(), "```", "");
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

async function runRepairCheck(
  check: WorkflowRepairCheck,
  context: WorkflowStepContext,
): Promise<RepairCheckResult> {
  const severity = check.severity ?? "error";
  try {
    if (check.type === "code") {
      const output = await check.run(context);
      return {
        id: check.id,
        passed: true,
        output:
          typeof output === "string" ? output : JSON.stringify(output ?? {}, null, 2),
        severity,
      };
    }

    const input = typeof check.input === "function"
      ? await check.input(context)
      : (check.input ?? {});
    const result = await context.runTool(check.tool, input);
    const output = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    return { id: check.id, passed: true, output, severity };
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    // A tool check that fails because the tool is not available in this execution context
    // (e.g. module tools not loaded in daemon workflow runs) is not actionable by the
    // repair agent — demote to warning so it does not block the repair loop.
    const effectiveSeverity =
      check.type !== "code" && output.startsWith("Unknown tool:") ? "warning" : severity;
    return { id: check.id, passed: false, output, severity: effectiveSeverity };
  }
}

async function executeRepairAgentIteration(
  step: WorkflowAgentStep,
  repairPrompt: string,
  abortController: AbortController,
  appendMessage: (message: SDKMessage) => void,
  agentConfig: AgentStepConfig,
): Promise<{ text: string; turns?: number; totalCostUsd?: number }> {
  const promptBody = readFileSync(
    resolve(step.moduleRoot, step.promptPath),
    "utf-8",
  );
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.projectDir);
  const systemPrompt = buildClaudeCodeSystemPrompt(
    agentConfig.config,
    promptBody,
    contextStartDir,
    agentConfig.projectDir,
  );
  const result = await executeWithAgentSDK(
    repairPrompt,
    {
      model: resolveAgentModel(step, agentConfig),
      cwd: agentConfig.projectDir,
      systemPrompt,
      maxTurns: step.maxTurns,
      effort: step.effort,
      thinkingEnabled: step.thinkingEnabled,
      thinkingBudget: step.thinkingBudget,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      permissionMode: step.permissionMode,
      persistSession: false,
      settingSources: step.settingSources,
      abortController,
      onMessage: appendMessage,
      canUseTool: createDaemonHostControlGuard(),
    },
    { write: () => true },
  );
  if (result.isError) {
    const detail = result.text.trim() || "Repair agent returned an error";
    throw new Error(`Repair agent for step "${step.id}" failed: ${detail}`);
  }
  return { text: result.text, turns: result.turns, totalCostUsd: result.totalCostUsd };
}

/**
 * Group checks by phase and run phases sequentially. Within a phase, checks
 * run in parallel. If any phase produces error-severity failures, later
 * phases are skipped — this avoids running expensive semantic checks (e.g.
 * critic review) when mechanical validations have already failed.
 */
async function runChecksPhased(
  checks: WorkflowRepairCheck[],
  context: WorkflowStepContext,
): Promise<{ failures: RepairCheckResult[]; warnings: RepairCheckResult[] }> {
  const phases = new Map<number, WorkflowRepairCheck[]>();
  for (const check of checks) {
    const p = check.phase ?? 0;
    if (!phases.has(p)) phases.set(p, []);
    phases.get(p)!.push(check);
  }
  const sortedPhases = [...phases.keys()].sort((a, b) => a - b);

  const allResults: RepairCheckResult[] = [];
  for (const phase of sortedPhases) {
    const phaseChecks = phases.get(phase)!;
    const results = await Promise.all(phaseChecks.map((c) => runRepairCheck(c, context)));
    allResults.push(...results);
    const hasErrors = results.some((r) => !r.passed && r.severity === "error");
    if (hasErrors) break;
  }

  return {
    failures: allResults.filter((r) => !r.passed && r.severity === "error"),
    warnings: allResults.filter((r) => !r.passed && r.severity === "warning"),
  };
}

export async function runAgentRepairLoop(
  step: WorkflowAgentStep,
  initialResult: WorkflowStepOutput,
  context: WorkflowStepContext,
  abortController: AbortController,
  appendMessage: (message: SDKMessage) => void,
  agentConfig: AgentStepConfig,
): Promise<WorkflowStepOutput> {
  const { checks, maxRepairAttempts } = step.repairLoop!;
  const iterations: RepairIteration[] = [];
  const base = (initialResult && typeof initialResult === "object") ? initialResult as Record<string, unknown> : {};
  let totalTurns = typeof base.turns === "number" ? base.turns : 0;
  let totalCostUsd = typeof base.totalCostUsd === "number" ? base.totalCostUsd : 0;
  let lastContent = typeof base.content === "string" ? base.content : "";
  let warnings = [] as RepairCheckResult[];

  if (abortController.signal.aborted) {
    return { ...base, content: lastContent, turns: totalTurns, totalCostUsd, repairIterations: iterations, repairWarnings: warnings };
  }

  const { failures: initialFailures, warnings: initialWarnings } = await runChecksPhased(checks, context);
  let failures = initialFailures;
  warnings = initialWarnings;

  for (let attempt = 1; failures.length > 0 && (maxRepairAttempts === undefined || attempt <= maxRepairAttempts); attempt++) {
    if (abortController.signal.aborted) break;

    const iteration: RepairIteration = { attempt, failures };

    const repairPrompt = buildRepairPrompt(attempt, maxRepairAttempts, failures, step, context.workflow.runDirPath);
    const repairResult = await executeRepairAgentIteration(
      step,
      repairPrompt,
      abortController,
      appendMessage,
      agentConfig,
    );

    iteration.agentResponse = repairResult.text;
    iteration.agentTurns = repairResult.turns;
    iteration.agentCostUsd = repairResult.totalCostUsd;
    iterations.push(iteration);

    lastContent = repairResult.text;
    totalTurns += repairResult.turns ?? 0;
    totalCostUsd += repairResult.totalCostUsd ?? 0;

    if (abortController.signal.aborted) break;

    const phased = await runChecksPhased(checks, context);
    failures = phased.failures;
    warnings = phased.warnings;

    if (failures.length > 0 && attempt === maxRepairAttempts) {
      throw new Error(
        `Repair loop for step "${step.id}" exhausted repair attempts (${maxRepairAttempts}). ` +
          `Still failing: ${failures.map((f) => f.id).join(", ")}`,
      );
    }
  }

  return {
    ...base,
    content: lastContent,
    turns: totalTurns,
    totalCostUsd,
    repairIterations: iterations,
    repairWarnings: warnings,
  };
}
