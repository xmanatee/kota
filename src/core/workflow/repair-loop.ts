import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createWorkflowAgentGuards,
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import type { WorkflowRepairCheck, WorkflowStepContext } from "./run-types.js";
import {
  AgentStepIdleTimeoutError,
  createStepIdleTimeoutMonitor,
  isAgentProgressMessage,
} from "./step-idle-timeout.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { AgentStepConfig, AgentStepResult } from "./steps/step-executor-agent.js";
import {
  resolveAgentModel,
  resolvePromptContextStartDir,
} from "./steps/step-executor-agent.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
} from "./steps/step-executor-retry.js";

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
  parentStep: WorkflowAgentStep,
): Promise<RepairCheckResult> {
  const severity = check.severity ?? "error";
  try {
    if (check.type === "code") {
      const output = await check.run(context, parentStep);
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
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
): Promise<{ text: string; turns?: number; totalCostUsd?: number }> {
  const promptBody = readFileSync(
    resolve(step.moduleRoot, step.promptPath),
    "utf-8",
  );
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.projectDir);
  const systemPrompt = buildKotaSystemPrompt(
    agentConfig.config,
    promptBody,
    contextStartDir,
    agentConfig.projectDir,
  );
  const harness = resolveAgentHarness(step.harness);
  const harnessOverrides = step.harnessOptions?.[harness.name];
  const attemptAbortController = new AbortController();
  const forwardAbort = () => attemptAbortController.abort(abortController.signal.reason);
  if (abortController.signal.aborted) {
    attemptAbortController.abort(abortController.signal.reason);
  } else {
    abortController.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const idleMonitor = step.idleTimeoutMs === undefined
    ? undefined
    : createStepIdleTimeoutMonitor({
        stepId: step.id,
        idleTimeoutMs: step.idleTimeoutMs,
        abortController: attemptAbortController,
        createError: (idleForMs) =>
          new AgentStepIdleTimeoutError(
            step.id,
            step.idleTimeoutMs!,
            idleForMs,
          ),
      });
  const messageCapture = harness.emitsAgentMessageStream
    ? (message: KotaAgentMessage) => {
        if (idleMonitor !== undefined && isAgentProgressMessage(message)) {
          idleMonitor.reportProgress({
            kind: "agent-message",
            messageType: message.type,
          });
        }
        appendMessage(message);
      }
    : undefined;

  try {
    const harnessRun = runAgentHarness(
      harness,
      {
        prompt: repairPrompt,
        model: resolveAgentModel(step, agentConfig),
        cwd: agentConfig.projectDir,
        systemPrompt,
        maxTurns: step.maxTurns,
        effort: step.effort,
        thinkingEnabled: step.thinkingEnabled,
        thinkingBudget: step.thinkingBudget,
        ...routeKotaToolControlOptions(harness, {
          allowedTools: step.allowedTools,
          disallowedTools: step.disallowedTools,
          canUseTool: createWorkflowAgentGuards(),
        }),
        autonomyMode: step.autonomyMode,
        harnessOverrides,
        abortController: attemptAbortController,
        ...(messageCapture !== undefined ? { onMessage: messageCapture } : {}),
      },
      { write: () => true },
    );
    const result = await (idleMonitor === undefined
      ? harnessRun
      : Promise.race([harnessRun, idleMonitor.timeout]));
    idleMonitor?.reportProgress({ kind: "agent-result" });
    if (result.isError) {
      const detail = result.text.trim() || "Repair agent returned an error";
      const classified = classifyAgentRuntimeFailure({
        message: detail,
        subtype: result.subtype,
      });
      if (classified) {
        // Mirror the initial-agent isError path in step-executor-agent.ts: the
        // SDK already exhausted its internal retry budget, so a fresh step-level
        // retry would just collide with the same outage. Throw a non-retryable
        // AgentStepRuntimeError so the run-executor surfaces the classified
        // backoff signal to AgentBackoffManager (provider-kind ≥5 min dispatch
        // delay) instead of a plain Error that the manager cannot read.
        throw new AgentStepRuntimeError(
          `Repair agent for step "${step.id}" failed: ${detail}`,
          classified.kind,
          false,
        );
      }
      throw new Error(`Repair agent for step "${step.id}" failed: ${detail}`);
    }
    return { text: result.text, turns: result.turns, totalCostUsd: result.totalCostUsd };
  } catch (error) {
    if (error instanceof AgentStepIdleTimeoutError) throw error;
    if (attemptAbortController.signal.reason instanceof AgentStepIdleTimeoutError) {
      throw attemptAbortController.signal.reason;
    }
    throw error;
  } finally {
    idleMonitor?.dispose();
    abortController.signal.removeEventListener("abort", forwardAbort);
  }
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
  parentStep: WorkflowAgentStep,
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
    const results = await Promise.all(
      phaseChecks.map((c) => runRepairCheck(c, context, parentStep)),
    );
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
  initialResult: AgentStepResult,
  context: WorkflowStepContext,
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

  const wrap = (output: Record<string, unknown>): AgentStepResult => ({
    output,
    harness: initialResult.harness,
    model: initialResult.model,
  });

  if (abortController.signal.aborted) {
    return wrap({ ...base, content: lastContent, turns: totalTurns, totalCostUsd, repairIterations: iterations, repairWarnings: warnings });
  }

  const { failures: initialFailures, warnings: initialWarnings } = await runChecksPhased(checks, context, step);
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

    const phased = await runChecksPhased(checks, context, step);
    failures = phased.failures;
    warnings = phased.warnings;

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
