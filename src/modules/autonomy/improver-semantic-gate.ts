import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import {
  type AgentJudgeConfig,
  getChangedFiles,
  getStagedDiff,
  getStagedDiffContent,
  handleVerdict,
  invokeAgentJudge,
  parseVerdict,
} from "./critic.js";

const GATE_MAX_TURNS = 10;
const ARTIFACT_NAME = "semantic-gate-review.json";

const GATE_SYSTEM_PROMPT = `You are a semantic quality gate for an autonomous improver workflow. Your job is to determine whether a staged diff represents a genuine, valuable improvement to the autonomy system — not just noise, process artifacts, or misleading busywork.

## What you check

- **Semantic value**: Does the diff actually improve the autonomy layer (prompts, workflows, validation, triggering, queue-shaping, docs that affect agent behavior)?
- **Artifact-only commits**: Reject diffs that only contain scratch files (.claude/worktrees/*, temporary build artifacts, leftover agent state) with no substantive code or config change.
- **Empty or no-op changes**: Reject diffs with no meaningful behavioral change — whitespace-only, import reordering without functional impact, or trivially circular edits.
- **Commit message honesty**: Does the commit message accurately describe the actual change? Reject misleading messages that claim improvements not present in the diff.
- **Documentation-only churn**: Documentation changes are valid only if they address a concrete observed issue or directly support a code change. Reject docs-only diffs with no connection to run evidence or current problems.
- **Evidence connection**: The improver should be working from observed run data or failure patterns. Changes that cannot be traced to any systemic issue are suspicious.

## What you do NOT check

- Code style, formatting, or naming (lint handles this)
- Whether tests pass (mechanical checks handle this)
- Whether the code compiles (mechanical checks handle this)
- The specific technical approach chosen (trust agent judgment on implementation)

## Calibration rules

- A change does not need to be large to be valuable. A one-line fix to a prompt or threshold can be highly impactful if it addresses a real pattern.
- Reject only when the diff clearly lacks semantic value. If a change is small but targeted and evidence-based, pass it.
- If the diff modifies autonomy code and the commit message plausibly matches, lean toward passing unless there is a concrete red flag.
- An artifact-only diff (.claude/worktrees/*, empty changes) is always a critical issue.

## Output format

Your entire response must be exactly one JSON object matching the schema below. Do not include narrative text, headings, checkmarks, bullet lists, commentary, or markdown before or after the JSON. Do not wrap the JSON in code fences. The first character of your response must be \`{\` and the last must be \`}\`.

Schema:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — each describes one reason the diff lacks semantic value"],
  "warnings": ["string — non-blocking observations"],
  "summary": "string — one sentence overall assessment"
}

Example:
{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"Diff tightens validation thresholds with direct run-trace evidence."}`;

const gateConfig: AgentJudgeConfig = {
  label: "Semantic gate",
  systemPrompt: GATE_SYSTEM_PROMPT,
  model: "claude-opus-4-7",
  maxTurns: GATE_MAX_TURNS,
  effort: "xhigh",
};

function readCommitMessage(runDirPath: string): string {
  const path = join(runDirPath, "commit-message.txt");
  if (!existsSync(path)) return "(no commit message found)";
  return readFileSync(path, "utf8").trim();
}

export function createImproverSemanticCheck(options?: {
  runDirPath?: string;
}): WorkflowRepairCheck {
  return {
    id: "semantic-quality-gate",
    type: "code" as const,
    run: async (ctx) => {
      const diffStat = getStagedDiff(ctx.projectDir);
      const changedFiles = getChangedFiles(ctx.projectDir);

      if (!changedFiles.trim()) {
        return "OK: no staged changes — skipping semantic gate";
      }

      const diffContent = getStagedDiffContent(ctx.projectDir);
      const runDir = options?.runDirPath ?? ctx.workflow.runDirPath;
      const commitMessage = readCommitMessage(runDir);

      const userMessage = [
        "## Commit message",
        commitMessage,
        "",
        "## Changed files",
        changedFiles,
        "",
        "## Diff summary",
        diffStat,
        "",
        "## Full diff",
        diffContent,
        "",
        "## Review context",
        `Project root: ${ctx.projectDir}`,
        `Run directory: ${runDir}`,
        "This is an improver workflow run. The diff should represent a genuine improvement to the autonomy layer based on evidence from recent runs.",
        "If you need to verify evidence, inspect run artifacts: metadata.json, steps/*.input.md, steps/*.events.jsonl.",
        "",
        "## Useful run artifact globs",
        `${runDir}/metadata.json`,
        `${runDir}/steps/*.input.md`,
        `${runDir}/steps/*.events.jsonl`,
      ].join("\n");

      const response = await invokeAgentJudge(userMessage, ctx.projectDir, gateConfig);
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir, ARTIFACT_NAME);
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir, ARTIFACT_NAME);
    },
  };
}
