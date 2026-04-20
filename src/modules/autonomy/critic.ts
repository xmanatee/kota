import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeCanUseTools,
  createAgentCommitGuard,
  createDaemonHostControlGuard,
  executeWithAgentSDK,
} from "#core/agent-sdk/index.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { AUTONOMY_AGENT_DEFAULTS, AUTONOMY_DISALLOWED_TOOLS, sleep } from "./shared.js";
import {
  extractTaskProbe,
  formatProbeBlock,
  runTaskProbe,
  type TaskProbeResult,
} from "./task-probe.js";
import { findTaskReviewTarget } from "./task-review-target.js";

export type CriticVerdict = {
  verdict: "pass" | "fail" | "pass_with_warnings";
  critical_issues: string[];
  warnings: string[];
  summary: string;
};

const CRITIC_SYSTEM_PROMPT = `You are a calibrated code review critic. Your job is to determine whether an agent's work genuinely and completely fulfills its assigned task.

## What you check

- **Completeness**: Does the work address everything the task requires? Are all "Done When" criteria met?
- **Honesty**: Does the task status match reality? If the task says "done", is the work actually done?
- **Consistency**: Do the changes match what the task asked for? Are there half-finished transitions, stale references, or contradictions between the task description and the actual changes?
- **Missed obligations**: If the task mentions updating docs, tests, or config — were those updates made?

## What you do NOT check

- Code style, formatting, or naming preferences (lint handles this)
- Whether tests pass (mechanical checks handle this)
- Whether the code compiles or type-checks (mechanical checks handle this)
- Minor refactoring opportunities or "nice to have" improvements
- Alternative approaches that could also work

## Calibration rules

- Only flag something as a critical issue if it represents a genuine gap: work that was required but not done, or a claim that is demonstrably false.
- If the work is substantially complete but has a minor omission that doesn't affect correctness, use a warning, not a critical issue.
- If required evidence is absent, fail rather than inferring completion from plausible-looking changes.
- An empty diff with a moved task file is suspicious — the agent may not have done real work.
- For research or URL-dependent tasks, verify that required sources were actually processed — not just referenced or dismissed. If the task depends on reading a URL and the source was inaccessible (auth-walled, 401/402/403, paywall, fetch failure), the task must not be marked done unless it records a blocker, creates a follow-up/enabler task, or documents why the source is no longer needed. Treat an unread required source marked as processed or dismissed without honest handling as a critical issue. Use the run trace when the diff alone is not enough.

## Output format

Your entire response must be exactly one JSON object matching the schema below. Do not include narrative text, headings, checkmarks, bullet lists, commentary, or markdown before or after the JSON. Do not wrap the JSON in code fences. The first character of your response must be \`{\` and the last must be \`}\`.

Schema:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — each describes one required-but-missing piece of work"],
  "warnings": ["string — non-blocking observations"],
  "summary": "string — one sentence overall assessment"
}

Example:
{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"All Done When criteria addressed with tests covering the new code."}`;

const GIT_MAX_BUFFER = 5 * 1024 * 1024;
const GIT_DIFF_MAX_BUFFER = 50 * 1024 * 1024;
const DIFF_CHAR_LIMIT = 80_000;

export function getStagedDiff(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--stat"], {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function getStagedDiffContent(projectDir: string): string {
  let diff: string;
  try {
    diff = execFileSync("git", ["diff", "--cached"], {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: GIT_DIFF_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "[Staged diff too large to capture — review via changed files and stat only]";
  }
  if (diff.length > DIFF_CHAR_LIMIT) {
    return `${diff.slice(0, DIFF_CHAR_LIMIT)}\n\n[... diff truncated at ${DIFF_CHAR_LIMIT / 1000}k chars ...]`;
  }
  return diff;
}

export function getChangedFiles(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    const parsed = tryParseJson(jsonBlockMatch[1].trim());
    if (parsed) return parsed;
  }
  const braceMatch = text.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
  if (braceMatch) {
    const parsed = tryParseJson(braceMatch[0]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function parseVerdict(text: string): CriticVerdict {
  const stripped = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = extractJson(text);
  }
  if (!parsed) {
    throw new Error(
      `Critic returned invalid JSON. Response (first 500 chars): ${stripped.slice(0, 500)}`,
    );
  }

  if (!parsed.verdict || !["pass", "fail", "pass_with_warnings"].includes(parsed.verdict as string)) {
    throw new Error(`Invalid verdict: ${parsed.verdict}`);
  }
  return {
    verdict: parsed.verdict as CriticVerdict["verdict"],
    critical_issues: Array.isArray(parsed.critical_issues) ? parsed.critical_issues : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

export function handleVerdict(verdict: CriticVerdict, runDir?: string, artifactName = "critic-review.json"): string {
  if (runDir && (verdict.warnings.length > 0 || verdict.critical_issues.length > 0)) {
    writeFileSync(
      join(runDir, artifactName),
      JSON.stringify(verdict, null, 2),
    );
  }

  if (verdict.verdict === "fail" && verdict.critical_issues.length > 0) {
    throw new Error(
      `Critic found ${verdict.critical_issues.length} critical issue(s):\n` +
        verdict.critical_issues.map((issue, i) => `  ${i + 1}. ${issue}`).join("\n") +
        (verdict.summary ? `\n\nSummary: ${verdict.summary}` : ""),
    );
  }

  const parts = [`OK: critic verdict — ${verdict.verdict}`];
  if (verdict.summary) parts.push(verdict.summary);
  if (verdict.warnings.length > 0) {
    parts.push(`(${verdict.warnings.length} warning(s) recorded in ${artifactName})`);
  }
  return parts.join(". ");
}

function runProbeIfDeclared(
  taskContent: string,
  projectDir: string,
  runDir: string,
): TaskProbeResult | null {
  const probe = extractTaskProbe(taskContent);
  if (!probe) return null;
  const result = runTaskProbe(probe, projectDir);
  writeFileSync(join(runDir, "runtime-probe.json"), JSON.stringify(result, null, 2));
  return result;
}

const CRITIC_MAX_TURNS = 20;

export type AgentJudgeConfig = {
  label: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;

const JSON_REMINDER =
  "\n\n## Format reminder\n" +
  "Your previous response did not contain valid JSON. Output exactly one JSON " +
  "object matching the schema in the system prompt — no narrative, no " +
  "checkmarks, no markdown, no code fences. The first character must be `{` " +
  "and the last must be `}`.";

export async function invokeAgentJudge(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
): Promise<{ text: string; isError: boolean; subtype?: string }> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  let lastError: Error | undefined;
  let needsFormatReminder = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryBaseDelayMs * attempt);
    }

    const promptForAttempt = needsFormatReminder ? userMessage + JSON_REMINDER : userMessage;

    let response: { text: string; isError: boolean; subtype?: string };
    try {
      response = await executeWithAgentSDK(promptForAttempt, {
        model: config.model,
        cwd,
        systemPrompt: config.systemPrompt,
        maxTurns: config.maxTurns,
        effort: config.effort,
        disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
        permissionMode: "bypassPermissions",
        settingSources: ["project"],
        canUseTool: composeCanUseTools(
          createDaemonHostControlGuard(),
          createAgentCommitGuard(),
        ),
      }, {
        write: () => true,
      });
    } catch (thrown) {
      lastError = new Error(
        `${config.label} threw (attempt ${attempt + 1}/${maxRetries}): ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
      needsFormatReminder = false;
      continue;
    }

    if (!response.isError) {
      try {
        parseVerdict(response.text);
        return response;
      } catch (error) {
        lastError = new Error(
          `${config.label} returned unparseable response (attempt ${attempt + 1}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`,
        );
        needsFormatReminder = true;
        continue;
      }
    }

    let failureDetail = response.text.trim() || response.subtype || "unknown error";
    if (response.text.trim()) {
      try {
        parseVerdict(response.text);
        return response;
      } catch (error) {
        failureDetail = error instanceof Error ? error.message : String(error);
        needsFormatReminder = true;
      }
    } else {
      needsFormatReminder = false;
    }

    lastError = new Error(
      `${config.label} failed (attempt ${attempt + 1}/${maxRetries}): ${failureDetail}`,
    );
  }
  throw lastError!;
}

const criticConfig: AgentJudgeConfig = {
  label: "Critic agent",
  systemPrompt: CRITIC_SYSTEM_PROMPT,
  model: AUTONOMY_AGENT_DEFAULTS.model,
  maxTurns: CRITIC_MAX_TURNS,
  effort: AUTONOMY_AGENT_DEFAULTS.effort,
};

export function createCriticCheck(options?: {
  runDirPath?: string;
}): WorkflowRepairCheck {
  return {
    id: "critic-review",
    type: "code" as const,
    run: async (ctx) => {
      const target = findTaskReviewTarget(ctx.projectDir);
      if (!target) {
        return "OK: no task in doing/ — skipping critic review";
      }

      const taskContent = target.content;
      const diffStat = getStagedDiff(ctx.projectDir);
      const diffContent = getStagedDiffContent(ctx.projectDir);
      const changedFiles = getChangedFiles(ctx.projectDir);
      const runDir = options?.runDirPath ?? ctx.workflow.runDirPath;

      const probeResult = runProbeIfDeclared(taskContent, ctx.projectDir, runDir);

      const userMessage = [
        "## Task (what was asked)",
        taskContent,
        "",
        "## Task state",
        `${target.path} (${target.state})`,
        "",
        "## Changed files",
        changedFiles,
        "",
        "## Review context",
        `Project root: ${ctx.projectDir}`,
        `Run directory: ${runDir}`,
        "Start from the task, final task state, changed files, and diff below.",
        "If completeness is uncertain, inspect run artifacts yourself: metadata.json, steps/*.input.md, steps/*.events.jsonl, steps/*.tool-telemetry.json, and related repo files.",
        "Do not require a specific evidence artifact. Use judgment, but do not accept claims that are unsupported by the task, diff, repo state, or run trace.",
        "",
        "## Useful run artifact globs",
        `${runDir}/metadata.json`,
        `${runDir}/steps/*.input.md`,
        `${runDir}/steps/*.events.jsonl`,
        `${runDir}/steps/*.tool-telemetry.json`,
        ...(probeResult ? ["", formatProbeBlock(probeResult)] : []),
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      const response = await invokeAgentJudge(userMessage, ctx.projectDir, criticConfig);
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir);
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir);
    },
  };
}
