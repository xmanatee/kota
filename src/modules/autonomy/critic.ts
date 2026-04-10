/**
 * Critic repair check: calls the Anthropic API to review agent work against
 * the original task, catching completeness gaps and inconsistencies that
 * mechanical checks miss.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";

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
- **Consistency**: Do the changes match what the task asked for? Are there half-finished migrations, stale references, or contradictions between the task description and the actual changes?
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
- When in doubt, pass. False positives waste expensive agent cycles.
- An empty diff with a moved task file is suspicious — the agent may not have done real work.

Respond with ONLY a JSON object (no markdown fences) matching this schema:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — each describes one required-but-missing piece of work"],
  "warnings": ["string — non-blocking observations"],
  "summary": "string — one sentence overall assessment"
}`;

function getTaskContent(projectDir: string): string | null {
  const doingDir = join(projectDir, "data/tasks/doing");
  if (!existsSync(doingDir)) return null;
  const files = readdirSync(doingDir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
  if (files.length === 0) return null;
  return readFileSync(join(doingDir, files[0]), "utf8");
}

function getStagedDiff(projectDir: string): string {
  try {
    return execFileSync("git", ["diff", "--cached", "--stat"], {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "(unable to get diff stat)";
  }
}

function getStagedDiffContent(projectDir: string): string {
  try {
    const diff = execFileSync("git", ["diff", "--cached"], {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 200 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Truncate if too large for the API context
    if (diff.length > 80_000) {
      return `${diff.slice(0, 80_000)}\n\n[... diff truncated at 80k chars ...]`;
    }
    return diff;
  } catch {
    return "(unable to get diff)";
  }
}

function getChangedFiles(projectDir: string): string {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "(unable to get changed files)";
  }
}

function parseVerdict(text: string): CriticVerdict {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Critic returned invalid JSON. Response (first 500 chars): ${cleaned.slice(0, 500)}`,
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

/**
 * Creates a critic repair check that calls the Anthropic API to review
 * agent work. Intended to be the last check in a repair loop so it runs
 * after all mechanical validations have passed.
 *
 * @param options.runDirPath - Path to the run directory for writing artifacts.
 *   If not provided, warnings are not persisted.
 */
export function createCriticCheck(options?: {
  runDirPath?: string;
}): WorkflowRepairCheck {
  return {
    id: "critic-review",
    type: "code" as const,
    run: async (ctx) => {
      const taskContent = getTaskContent(ctx.projectDir);
      if (!taskContent) {
        return "OK: no task in doing/ — skipping critic review";
      }

      const diffStat = getStagedDiff(ctx.projectDir);
      const diffContent = getStagedDiffContent(ctx.projectDir);
      const changedFiles = getChangedFiles(ctx.projectDir);

      const userMessage = [
        "## Task (what was asked)",
        taskContent,
        "",
        "## Changed files",
        changedFiles,
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      const client = new Anthropic();
      const response = await client.messages.create({
        model: CRITIC_MODEL,
        max_tokens: 1024,
        system: CRITIC_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const responseText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const verdict = parseVerdict(responseText);

      // Persist warnings as run artifact
      const runDir = options?.runDirPath ?? ctx.workflow.runDirPath;
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

      // pass or pass_with_warnings — both succeed
      const parts = [`OK: critic verdict — ${verdict.verdict}`];
      if (verdict.summary) parts.push(verdict.summary);
      if (verdict.warnings.length > 0) {
        parts.push(`(${verdict.warnings.length} warning(s) recorded in critic-review.json)`);
      }
      return parts.join(". ");
    },
  };
}
