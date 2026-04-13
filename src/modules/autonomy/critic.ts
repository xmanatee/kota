/**
 * Critic repair check: reviews agent work against the original task, catching
 * completeness gaps and inconsistencies that mechanical checks miss.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeWithAgentSDK } from "#core/agent-sdk/index.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { findTaskReviewTarget } from "./task-review-target.js";

export type CriticVerdict = {
  verdict: "pass" | "fail" | "pass_with_warnings";
  critical_issues: string[];
  warnings: string[];
  summary: string;
};

const CRITIC_MODEL = "claude-sonnet-4-6";

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
- For research or URL-dependent tasks, verify that required sources were actually processed. Use the run trace when the diff alone is not enough.

Respond with ONLY a JSON object (no markdown fences) matching this schema:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — each describes one required-but-missing piece of work"],
  "warnings": ["string — non-blocking observations"],
  "summary": "string — one sentence overall assessment"
}`;

function getStagedDiff(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--stat"], {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 50 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getStagedDiffContent(projectDir: string): string {
  const diff = execFileSync("git", ["diff", "--cached"], {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 200 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (diff.length > 80_000) {
    return `${diff.slice(0, 80_000)}\n\n[... diff truncated at 80k chars ...]`;
  }
  return diff;
}

function getChangedFiles(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    encoding: "utf8",
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

function parseVerdict(text: string): CriticVerdict {
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

function handleVerdict(verdict: CriticVerdict, runDir?: string): string {
  if (runDir && (verdict.warnings.length > 0 || verdict.critical_issues.length > 0)) {
    writeFileSync(
      join(runDir, "critic-review.json"),
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
    parts.push(`(${verdict.warnings.length} warning(s) recorded in critic-review.json)`);
  }
  return parts.join(". ");
}

/**
 * Creates a critic repair check for agent work. Intended to be the last check
 * in a repair loop so it runs after all mechanical validations have passed.
 *
 * @param options.runDirPath - Path to the run directory for writing artifacts.
 *   If not provided, warnings are not persisted.
 */
const CRITIC_MAX_RETRIES = 3;
const CRITIC_MAX_TURNS = 12;
const CRITIC_RETRY_BASE_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeCritic(
  userMessage: string,
  cwd: string,
): Promise<{ text: string; isError: boolean; subtype?: string }> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < CRITIC_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(CRITIC_RETRY_BASE_DELAY_MS * attempt);
    }

    const response = await executeWithAgentSDK(userMessage, {
      model: CRITIC_MODEL,
      cwd,
      systemPrompt: CRITIC_SYSTEM_PROMPT,
      maxTurns: CRITIC_MAX_TURNS,
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
    }, {
      write: () => true,
    });

    if (!response.isError) return response;

    let failureDetail = response.text.trim() || response.subtype || "unknown error";
    if (response.text.trim()) {
      try {
        parseVerdict(response.text);
        return response;
      } catch (error) {
        failureDetail = error instanceof Error ? error.message : String(error);
      }
    }

    lastError = new Error(
      `Critic agent failed (attempt ${attempt + 1}/${CRITIC_MAX_RETRIES}): ${failureDetail}`,
    );
  }
  throw lastError!;
}

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
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      const response = await invokeCritic(userMessage, ctx.projectDir);
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir);
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir);
    },
  };
}
