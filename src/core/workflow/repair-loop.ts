import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  executeWithAgentSDK,
} from "../agent-sdk/index.js";
import type { SDKMessage } from "../agent-sdk/types.js";
import type { WorkflowRepairCheck, WorkflowStepContext } from "./run-types.js";
import type { AgentStepConfig, WorkflowStepOutput } from "./step-executor-agent.js";
import { resolveAgentModel } from "./step-executor-agent.js";
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
  maxRepairAttempts: number,
  failures: RepairCheckResult[],
  step: WorkflowAgentStep,
): string {
  const lines = [
    `Post-check repair attempt ${attempt}/${maxRepairAttempts} for step "${step.id}".`,
    "",
    "The following checks failed after your previous work:",
    "",
  ];
  for (const failure of failures) {
    lines.push(`## ${failure.id}`, "```", failure.output.trim(), "```", "");
  }
  lines.push(
    "Fix these issues now. The same checks will run again after you finish.",
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
    resolve(agentConfig.projectDir, step.promptPath),
    "utf-8",
  );
  const promptDir = dirname(resolve(agentConfig.projectDir, step.promptPath));
  const systemPrompt = buildClaudeCodeSystemPrompt(
    agentConfig.config,
    promptBody,
    promptDir,
    agentConfig.projectDir,
  );
  const result = await executeWithAgentSDK(
    repairPrompt,
    {
      model: resolveAgentModel(step, agentConfig),
      cwd: agentConfig.projectDir,
      systemPrompt,
      maxTurns: step.maxTurns,
      maxBudgetUsd: step.maxBudgetUsd,
      thinkingEnabled: step.thinkingEnabled,
      thinkingBudget: step.thinkingBudget,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      permissionMode: step.permissionMode,
      persistSession: false,
      settingSources: step.settingSources,
      abortController,
      onMessage: appendMessage,
    },
    { write: () => true },
  );
  if (result.isError) {
    const detail = result.text.trim() || "Repair agent returned an error";
    throw new Error(`Repair agent for step "${step.id}" failed: ${detail}`);
  }
  return { text: result.text, turns: result.turns, totalCostUsd: result.totalCostUsd };
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

  let checkResults = await Promise.all(checks.map((c) => runRepairCheck(c, context)));
  let failures = checkResults.filter((r) => !r.passed && r.severity === "error");
  warnings = checkResults.filter((r) => !r.passed && r.severity === "warning");

  for (let attempt = 1; attempt <= maxRepairAttempts && failures.length > 0; attempt++) {
    const iteration: RepairIteration = { attempt, failures };

    const repairPrompt = buildRepairPrompt(attempt, maxRepairAttempts, failures, step);
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

    checkResults = await Promise.all(checks.map((c) => runRepairCheck(c, context)));
    failures = checkResults.filter((r) => !r.passed && r.severity === "error");
    warnings = checkResults.filter((r) => !r.passed && r.severity === "warning");

    if (failures.length > 0 && attempt === maxRepairAttempts) {
      throw new Error(
        `Repair loop for step "${step.id}" exhausted budget (${maxRepairAttempts} attempt(s)). ` +
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
