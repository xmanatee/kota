import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWorkflowAgentGuards,
  resolveAgentHarness,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
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
- For client/channel tasks (\`area: client\` or \`area: channel\`), if the task declares a screenshot, screencast, rendered artifact/fixture, transcript, runtime probe, or visual evidence in its Desired Outcome, Done When, or Acceptance Evidence, the run directory must contain that artifact. A prose description of what an operator would see does not satisfy a declared rendered-evidence requirement. If the artifact is missing without an explicit operator-capture precondition or blocked-task escalation, fail with a critical issue.

## Critical-issue vs warning classification

The autonomy contract requires the loop to turn quality drift into corrective action. Use these defaults to decide whether a concern is blocking, non-blocking, or notification-only. Borderline cases bias toward warning + recorded follow-up, not silent acceptance.

Treat these as **critical issues** that block the run:

- **Weak rendered evidence on a task that declared a visible artifact.** A text description, mocked screenshot, or unchecked-in fixture does not satisfy a Done-When that asks for a real screenshot, screencast, transcript, or runtime probe. An artifact that exists but does not actually demonstrate the declared behavior (e.g. a transcript whose only output is an auth/config preflight failure with no observable per-feature behavior) does not satisfy the requirement either.
- **Placeholder or no-value tests.** Tests that assert on the input the agent just wrote, that always pass without exercising the code under change, or that are scoped so narrowly they cannot regress.
- **Untracked compatibility shims.** A new \`legacyEffect()\`, \`*Old\`, \`*Legacy\`, or alias re-export added without a tracked removal task is debt the contract forbids.
- **Baseline-only strictness ratchets.** Adding new entries to a strict-types or any-other baseline file in the same direction the baseline is supposed to shrink, without a tracked removal task or rationale. A baseline addition for a file outside the task's stated scope ("unrelated entry", "if this is inadvertent regeneration") is itself the regression — flag it as critical, do not hedge with "if".
- **Required-source dishonesty.** A task depending on an external source where the source was 401/403/paywalled/fetch-failed and the run pretends it was processed.
- **Done-When item not implemented and not traced.** A Done-When line that this change does not address and is not deferred to a named follow-up task or recorded as a known limitation in the task body. "Acceptable because…" without a tracked trace is acceptance, not deferral. If you find yourself writing "not implemented in this change", "remains" / "still", or "not traced to a follow-up" about a Done-When item, that is a critical issue, not a warning.
- **Runtime defect masked by missing test coverage.** A code change that introduces or leaves a behavior bug visible on the real execution path (TTY rendering, network call, file write, event emit) which mechanical checks pass only because the existing tests do not exercise that path. Phrasings like "tests only check X, so this defect passes mechanically", "on a real TTY this will print literal …", "the runtime path is wrong but the test stubs around it" mean the change ships broken — fail the run and require either the bug be fixed or the missing test be added.

Treat these as **warnings** that still allow pass — but only when accompanied by a durable trace:

- A localized caveat that does not affect correctness (one stylistic improvement opportunity, one comment that could be tighter).
- An accepted trade-off that is named in the run summary, recorded as a known limitation in the task body, or has a follow-up task created in this run or a prior one.

When you keep a non-trivial warning in \`pass\` or \`pass_with_warnings\`, your \`summary\` must name the trace: which follow-up task, which task-body limitation paragraph, or which non-action reason the warning is being deferred against. A warning with no named trace and no harmless-caveat justification belongs in \`critical_issues\`, not \`warnings\`.

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
  // Always persist the verdict so live-run calibration tracking can read it
  // back later; operators inspecting a run that passed cleanly no longer need
  // to infer the verdict from the step's repair-iteration output. Repeat
  // critic invocations within one run overwrite the file so it reflects the
  // final verdict.
  if (runDir) {
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
  /**
   * Registered agent-harness name to dispatch this judge through. Required —
   * judges stay harness-neutral, so every caller must pass the harness it
   * resolved (normally the parent agent step's `step.harness`, which the
   * validator filled from `config.defaultAgentHarness`).
   */
  harness: string;
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
  const harness = resolveAgentHarness(config.harness);
  let lastError: Error | undefined;
  let needsFormatReminder = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryBaseDelayMs * attempt);
    }

    const promptForAttempt = needsFormatReminder ? userMessage + JSON_REMINDER : userMessage;

    let response: { text: string; isError: boolean; subtype?: string };
    try {
      response = await runAgentHarness(
        harness,
        {
          prompt: promptForAttempt,
          model: config.model,
          cwd,
          systemPrompt: config.systemPrompt,
          maxTurns: config.maxTurns,
          effort: config.effort,
          disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
          autonomyMode: "autonomous",
          canUseTool: createWorkflowAgentGuards(),
        },
        {
          write: () => true,
        },
      );
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      lastError = new Error(
        `${config.label} threw (attempt ${attempt + 1}/${maxRetries}): ${message}`,
      );
      const code = thrown instanceof Error
        ? (thrown as NodeJS.ErrnoException).code
        : undefined;
      const classification = classifyAgentRuntimeFailure({
        message,
        code,
        errorName: thrown instanceof Error ? thrown.name : undefined,
      });
      if (!classification?.retryable) throw lastError;
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

    // isError=true path. Prefer to recover a parseable verdict from any
    // emitted text before deciding whether to retry — an agent that hit
    // max_turns may still have produced a valid JSON verdict before bailing.
    if (response.text.trim()) {
      try {
        parseVerdict(response.text);
        return response;
      } catch {
        // unparseable — fall through to classification
      }
    }

    const failureDetail = response.text.trim() || response.subtype || "unknown error";
    lastError = new Error(
      `${config.label} failed (attempt ${attempt + 1}/${maxRetries}): ${failureDetail}`,
    );

    // Runaway subtypes (error_max_turns, error_max_tokens) are deterministic
    // budget exhaustion, not transient provider problems. Retrying burns
    // budget without changing the turn/token ceiling. Fail fast on anything
    // the classifier does not explicitly mark retryable — same policy the
    // workflow step-executor applies to agent steps.
    const classification = classifyAgentRuntimeFailure({
      message: response.text,
      subtype: response.subtype,
    });
    if (!classification?.retryable) throw lastError;
    needsFormatReminder = false;
  }
  throw lastError!;
}

type CriticBaseConfig = Omit<AgentJudgeConfig, "harness">;

const criticBaseConfig: CriticBaseConfig = {
  label: "Critic agent",
  systemPrompt: CRITIC_SYSTEM_PROMPT,
  model: AUTONOMY_AGENT_DEFAULTS.model,
  maxTurns: CRITIC_MAX_TURNS,
  effort: AUTONOMY_AGENT_DEFAULTS.effort,
};

/**
 * True when a thrown `invokeAgentJudge` error represents runaway budget
 * exhaustion (max turns / max tokens) rather than a defect in the diff
 * being reviewed. The repair-loop caller uses this to degrade the check
 * to a warning: a repair agent cannot shrink the judge's turn budget by
 * editing code, so iterating would be wasted work. Keyed on stable SDK
 * signals (result subtype and canonical CLI error phrase).
 */
export function isJudgeRunawayError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/error_max_turns|error_max_tokens/i.test(message)) return true;
  if (/Reached maximum number of (?:turns|tokens)/i.test(message)) return true;
  return false;
}

export function judgeUnavailableResult(label: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `WARN: ${label} unavailable (${detail}). ` +
    `Skipping gate for this run; the diff proceeds on mechanical checks only. ` +
    `See evaluator-calibration.json (verdict=absent).`
  );
}

export function createCriticCheck(options?: {
  runDirPath?: string;
  /**
   * Force a specific harness name. Production callers leave this unset so the
   * check dispatches through the parent agent step's resolved harness (which
   * the validator populated from `config.defaultAgentHarness`). Tests use it
   * to drive the critic over a specific adapter directly.
   */
  harnessName?: string;
  /** Override the critic model. Defaults to AUTONOMY_AGENT_DEFAULTS.model. */
  model?: string;
}): WorkflowRepairCheck {
  const baseConfig: CriticBaseConfig = {
    ...criticBaseConfig,
    ...(options?.model !== undefined ? { model: options.model } : {}),
  };
  return {
    id: "critic-review",
    type: "code" as const,
    run: async (ctx, parentStep) => {
      const harnessName = options?.harnessName ?? parentStep.harness;
      const resolvedConfig: AgentJudgeConfig = { ...baseConfig, harness: harnessName };
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
        "If completeness is uncertain, inspect run artifacts yourself: metadata.json, steps/*.json (structured step outputs), steps/*.input.md, steps/*.tool-telemetry.json, and related repo files.",
        "Do not require a specific evidence artifact. Use judgment, but do not accept claims that are unsupported by the task, diff, repo state, or run trace.",
        "You have a 20-turn budget. Budget it for judgment, not exploration: the diff, task, and step JSON outputs are almost always enough. Do not open `steps/*.events.jsonl` — it is a raw per-tool event stream, routinely 1–3 MB, and burns the budget without adding signal. Reach for it only if nothing else explains a concrete gap you already suspect.",
        "",
        "## Useful run artifact globs",
        `${runDir}/metadata.json`,
        `${runDir}/steps/*.json`,
        `${runDir}/steps/*.input.md`,
        `${runDir}/steps/*.tool-telemetry.json`,
        ...(probeResult ? ["", formatProbeBlock(probeResult)] : []),
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
      ].join("\n");

      let response: Awaited<ReturnType<typeof invokeAgentJudge>>;
      try {
        response = await invokeAgentJudge(userMessage, ctx.projectDir, resolvedConfig);
      } catch (err) {
        // Runaway judge (max turns / max tokens) is an evaluator-side
        // problem the agent cannot fix by editing code. Returning a
        // warning lets the build proceed on mechanical checks and
        // prevents repair-loop thrashing. Evidence: run
        // 2026-04-20T14-30-41-306Z-builder-gb9pnn wasted 3 repair
        // iterations (~$3.73, ~45 min) on this exact path before the
        // critic finally returned a verdict on its own.
        if (isJudgeRunawayError(err)) {
          return judgeUnavailableResult("critic", err);
        }
        throw err;
      }
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir);
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir);
    },
  };
}
