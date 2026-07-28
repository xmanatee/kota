import { createHash } from "node:crypto";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import {
  type AgentJudgeConfig,
  invokeAgentJudge,
  isJudgeRunawayError,
  judgeUnavailableResult,
} from "./agent-judge.js";
import {
  getChangedFiles,
  getStagedDiff,
  getStagedDiffContent,
} from "./critic-diff.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";
import { handleVerdict, parseVerdict } from "./critic-verdict.js";
import {
  checkProductOperatorEvidence,
  resolveDurableOperatorEvidenceDir,
} from "./product-evidence.js";
import { fileLineCitationsFromUnifiedDiff } from "./review-scrutiny-citations.js";
import { AUTONOMY_AGENT_DEFAULTS } from "./shared.js";
import { formatProbeBlock } from "./task-probe.js";
import { findTaskReviewTarget } from "./task-review-target.js";

export type { AgentJudgeConfig } from "./agent-judge.js";
export {
  invokeAgentJudge,
  isJudgeRunawayError,
  judgeUnavailableResult,
} from "./agent-judge.js";
export {
  getChangedFiles,
  getStagedDiff,
  getStagedDiffContent,
} from "./critic-diff.js";
export type { CriticVerdict } from "./critic-verdict.js";
export { handleVerdict, parseVerdict } from "./critic-verdict.js";

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
- For accepted work, the \`summary\` must cite at least one concrete reviewed file/line such as \`src/path/file.ts:123\` or \`src/path/file.ts#L123\`, unless the run truly changed no reviewable repo file. This citation is an inspectable review-scrutiny signal, not a hidden reasoning trace.
- For \`task_class: Product\`, inspect operator journey evidence: CLI transcript, screenshot, runtime probe, rendered fixture, trace, snapshot, demo, or equivalent. Green tests alone are not enough; a Product task with passing implementation checks but no operator-visible evidence is a critical issue.
- For research or URL-dependent tasks, verify that required sources were actually processed — not just referenced or dismissed. If the task depends on reading a URL and the source was inaccessible (auth-walled, 401/402/403, paywall, fetch failure), the task must not be marked done unless it records a blocker, creates a follow-up/enabler task, or documents why the source is no longer needed. Treat an unread required source marked as processed or dismissed without honest handling as a critical issue. Use the run trace when the diff alone is not enough.
- For client/channel tasks (\`area: client\` or \`area: channel\`), if the task declares a screenshot, screencast, rendered artifact/fixture, transcript, runtime probe, or visual evidence in its Desired Outcome, Done When, or Acceptance Evidence, the run directory must contain that artifact. A prose description of what an operator would see does not satisfy a declared rendered-evidence requirement. If the artifact is missing without an explicit operator-capture precondition or blocked-task escalation, fail with a critical issue.

## Critical-issue vs warning classification

The autonomy contract requires the loop to turn quality drift into corrective action. Use these defaults to decide whether a concern is blocking, non-blocking, or notification-only. Borderline cases bias toward warning + recorded follow-up, not silent acceptance.

Treat these as **critical issues** that block the run:

- **Weak rendered evidence on a task that declared a visible artifact.** A text description, mocked screenshot, or unchecked-in fixture does not satisfy a Done-When that asks for a real screenshot, screencast, transcript, or runtime probe. An artifact that exists but does not actually demonstrate the declared behavior (e.g. a transcript whose only output is an auth/config preflight failure with no observable per-feature behavior) does not satisfy the requirement either.
- **Product work with green tests but unchanged operator UX.** A \`task_class: Product\` completion that has implementation tests but no operator journey evidence must fail; the absence of a transcript, screenshot, runtime probe, rendered fixture, trace, snapshot, demo, or equivalent means the actual human path was not proven.
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
{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"All Done When criteria addressed with tests covering src/example.ts:42."}`;

/**
 * Stable identifier for the active critic system prompt. The live calibration
 * gate aggregates only artifacts whose hash matches the running critic — when
 * the prompt is tightened (a new class promoted to a critical issue, an old
 * class softened), the rolling window resets to fresh data instead of letting
 * historical verdicts drag the rate above threshold for the rest of the
 * window. 12 hex chars (48 bits) is plenty to distinguish prompt versions.
 */
export function getCriticPromptHash(): string {
  return createHash("sha256").update(CRITIC_SYSTEM_PROMPT).digest("hex").slice(0, 12);
}

const CRITIC_MAX_TURNS = 20;

type CriticBaseConfig = Omit<AgentJudgeConfig, "harness">;

const criticBaseConfig: CriticBaseConfig = {
  label: "Critic agent",
  systemPrompt: CRITIC_SYSTEM_PROMPT,
  model: AUTONOMY_AGENT_DEFAULTS.model,
  maxTurns: CRITIC_MAX_TURNS,
  effort: AUTONOMY_AGENT_DEFAULTS.effort,
};

function taskIdFromReviewTargetPath(path: string): string | undefined {
  return path.match(/(?:^|\/)(task-[^/]+)\.md$/)?.[1];
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
      const reviewDir = ctx.workspaceDir ?? ctx.projectDir;
      const harnessName = options?.harnessName ?? parentStep.harness;
      const resolvedConfig: AgentJudgeConfig = { ...baseConfig, harness: harnessName };
      const target = findTaskReviewTarget(reviewDir);
      if (!target) {
        return "OK: no task in doing/ — skipping critic review";
      }

      const taskContent = target.content;
      const diffStat = getStagedDiff(reviewDir);
      const diffContent = getStagedDiffContent(reviewDir);
      const changedFiles = getChangedFiles(reviewDir);
      const workspaceRunDir = ctx.runtimeResources?.agentRunDir;
      const runDir = options?.runDirPath ?? workspaceRunDir ?? ctx.workflow.runDirPath;
      const durableEvidenceDir = options?.runDirPath !== undefined
        ? runDir
        : resolveDurableOperatorEvidenceDir(reviewDir, runDir);
      const taskId = taskIdFromReviewTargetPath(target.path);
      const fallbackFileLineCitations = fileLineCitationsFromUnifiedDiff(diffContent);
      const verdictContext = {
        runId: ctx.workflow.runId,
        workflow: ctx.workflow.name,
        reviewerPromptHash: getCriticPromptHash(),
        taskId,
        fallbackFileLineCitations,
      };

      const probeResult = runProbeIfDeclared(
        taskContent,
        target.path,
        reviewDir,
        runDir,
        options?.runDirPath === undefined && workspaceRunDir !== undefined
          ? reviewDir
          : undefined,
      );
      const productEvidence = checkProductOperatorEvidence({
        taskContent,
        taskState: target.state,
        evidenceDirPath: durableEvidenceDir,
        changedFiles,
        hasRuntimeProbeResult: probeResult !== null,
      });
      if (productEvidence.required && !productEvidence.satisfied) {
        return handleVerdict(
          {
            verdict: "fail",
            critical_issues: [productEvidence.reason ?? "Missing Product evidence."],
            warnings: [],
            summary:
              "Product task review failed before agent judgment because operator journey evidence is absent.",
          },
          runDir,
          "critic-review.json",
          verdictContext,
        );
      }

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
        `Project root: ${reviewDir}`,
        `Run directory: ${runDir}`,
        "Start from the task, final task state, changed files, and diff below.",
        "If completeness is uncertain, inspect run artifacts yourself: metadata.json, steps/*.json (structured step outputs), steps/*.input.md, steps/*.tool-telemetry.json, and related repo files.",
        "Do not require a specific evidence artifact. Use judgment, but do not accept claims that are unsupported by the task, diff, repo state, or run trace.",
        productEvidence.required
          ? `Product operator evidence refs detected: ${productEvidence.refs.join(", ")}`
          : "Product operator evidence requirement: not applicable.",
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
        response = await invokeAgentJudge(userMessage, reviewDir, resolvedConfig);
      } catch (err) {
        const judgeError = err instanceof Error ? err : new Error(String(err));
        // Runaway judge (max turns / max tokens) is an evaluator-side
        // problem the agent cannot fix by editing code. Returning a
        // warning lets the build proceed on mechanical checks and
        // prevents repair-loop thrashing. Evidence: run
        // 2026-04-20T14-30-41-306Z-builder-gb9pnn wasted 3 repair
        // iterations (~$3.73, ~45 min) on this exact path before the
        // critic finally returned a verdict on its own.
        if (isJudgeRunawayError(judgeError)) {
          return judgeUnavailableResult("critic", judgeError);
        }
        throw err;
      }
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir, "critic-review.json", {
          ...verdictContext,
          failureDetailMode: "artifact-reference",
        });
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir, "critic-review.json", {
        ...verdictContext,
        failureDetailMode: "artifact-reference",
      });
    },
  };
}
