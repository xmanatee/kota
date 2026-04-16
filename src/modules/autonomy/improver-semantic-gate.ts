import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeWithAgentSDK } from "#core/agent-sdk/index.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import {
  getChangedFiles,
  getStagedDiff,
  getStagedDiffContent,
  handleVerdict,
  parseVerdict,
} from "./critic.js";
import { AUTONOMY_DISALLOWED_TOOLS, sleep } from "./shared.js";

const GATE_MODEL = "claude-opus-4-6";
const GATE_MAX_RETRIES = 3;
const GATE_RETRY_BASE_DELAY_MS = 2_000;
const GATE_MAX_TURNS = 15;
const ARTIFACT_NAME = "semantic-gate-review.json";

const GATE_SYSTEM_PROMPT = `You are a semantic quality gate for an autonomous improver workflow. Your job is to determine whether a staged diff represents a genuine, valuable improvement to the autonomy system — not just noise, process artifacts, or misleading busywork.

## What you check

- **Semantic value**: Does the diff actually improve the autonomy layer (prompts, workflows, validation, triggering, queue-shaping, docs that affect agent behavior)?
- **Artifact-only commits**: Reject diffs that only contain scratch files (.claude/worktrees/*, temporary build artifacts, leftover agent state) with no substantive code or config change.
- **Empty or no-op changes**: Reject diffs with no meaningful behavioral change — whitespace-only, import reordering without functional impact, or trivially circular edits.
- **Commit message honesty**: Does the commit message accurately describe the actual change? Reject misleading messages that claim improvements not present in the diff.
- **Documentation-only churn**: Documentation changes are valid only if they address a concrete observed issue or directly support a code change. Reject docs-only diffs with no connection to run evidence or current problems.
- **Evidence connection**: The improver should be working from observed run data, failure patterns, or cost evidence. Changes that cannot be traced to any systemic issue are suspicious.

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

Respond with ONLY a JSON object (no markdown fences) matching this schema:
{
  "verdict": "pass" | "fail" | "pass_with_warnings",
  "critical_issues": ["string — each describes one reason the diff lacks semantic value"],
  "warnings": ["string — non-blocking observations"],
  "summary": "string — one sentence overall assessment"
}`;

async function invokeGate(
  userMessage: string,
  cwd: string,
): Promise<{ text: string; isError: boolean; subtype?: string }> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < GATE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(GATE_RETRY_BASE_DELAY_MS * attempt);
    }

    let response: { text: string; isError: boolean; subtype?: string };
    try {
      response = await executeWithAgentSDK(userMessage, {
        model: GATE_MODEL,
        cwd,
        systemPrompt: GATE_SYSTEM_PROMPT,
        maxTurns: GATE_MAX_TURNS,
        effort: "max",
        disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
        permissionMode: "bypassPermissions",
        settingSources: ["project"],
      }, {
        write: () => true,
      });
    } catch (thrown) {
      lastError = new Error(
        `Semantic gate threw (attempt ${attempt + 1}/${GATE_MAX_RETRIES}): ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
      continue;
    }

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
      `Semantic gate failed (attempt ${attempt + 1}/${GATE_MAX_RETRIES}): ${failureDetail}`,
    );
  }
  throw lastError!;
}

function readCommitMessage(runDirPath: string): string {
  try {
    return readFileSync(join(runDirPath, "commit-message.txt"), "utf8").trim();
  } catch {
    return "(no commit message found)";
  }
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

      const response = await invokeGate(userMessage, ctx.projectDir);
      if (response.isError) {
        const recovered = parseVerdict(response.text);
        return handleVerdict(recovered, runDir, ARTIFACT_NAME);
      }

      const verdict = parseVerdict(response.text);
      return handleVerdict(verdict, runDir, ARTIFACT_NAME);
    },
  };
}
