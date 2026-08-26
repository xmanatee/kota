import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { assess, nonInteractiveConfig } from "#core/tools/guardrails.js";
import { getToolEffect } from "#core/tools/index.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import type { RepoAiCheckDefinition } from "#modules/repo-ai-checks/discovery.js";
import type {
  CheckForeachOutput,
  DiscoveredCheckRun,
  PreparedRepoAiCheckComment,
  RecordedCheckResult,
  RepoAiCheckAgentResult,
  RepoAiCheckCommentPolicy,
  RepoAiCheckSummary,
  RepoAiCheckVerdict,
} from "./workflow-contracts.js";
import { validateCheckAgentResult } from "./workflow-contracts.js";

const MAX_CHECK_COMMENT_BODY_CHARS = 4_000;
const CHECK_COMMENT_TRUNCATION_NOTICE = "\n\n[Repo-local AI check summary truncated]";

export function writeJsonArtifact(filePath: string, value: object): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function artifactFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "check";
}

export function githubCommentInput(comment: PreparedRepoAiCheckComment) {
  return { repo: comment.repo, number: comment.prNumber, body: comment.body };
}

export function assessCommentPolicy(
  workspaceRoot: string,
  input: ReturnType<typeof githubCommentInput>,
): RepoAiCheckCommentPolicy {
  if (getToolEffect("github_comment") === undefined) {
    return {
      postAllowed: false,
      approvalRequired: false,
      policy: "unavailable",
      reason: "github_comment is not registered, so the advisory comment is skipped",
    };
  }
  const assessment = assess(
    "github_comment",
    input,
    nonInteractiveConfig(loadConfig(workspaceRoot).guardrails),
  );
  if (assessment.policy === "deny") {
    return {
      postAllowed: false,
      approvalRequired: false,
      policy: assessment.policy,
      reason: assessment.reason,
    };
  }
  return {
    postAllowed: true,
    approvalRequired: assessment.policy === "queue" || assessment.policy === "confirm",
    policy: assessment.policy,
    reason: assessment.reason,
  };
}

function countVerdicts(
  results: RecordedCheckResult[],
  verdict: RepoAiCheckVerdict,
): number {
  return results.filter((result) => result.verdict === verdict).length;
}

export function buildCheckArtifact(
  discovery: DiscoveredCheckRun,
  check: RepoAiCheckDefinition,
  result: RepoAiCheckAgentResult,
) {
  return {
    check: {
      id: check.id,
      name: check.name,
      description: check.description,
      provenance: check.provenance,
    },
    pullRequest: {
      repo: discovery.repo,
      number: discovery.prNumber,
      title: discovery.title,
      headBranch: discovery.headBranch,
      baseBranch: discovery.baseBranch,
      headSha: discovery.headSha,
    },
    verdict: result.verdict,
    rationale: result.rationale,
    ...(result.suggestedFix ? { suggestedFix: result.suggestedFix } : {}),
  };
}

function extractForeachOutput(ctx: WorkflowStepContext): CheckForeachOutput {
  return expectStructuredOutput<CheckForeachOutput>(ctx.stepOutputs["run-checks"], [
    "items",
    "results",
  ]);
}

export function summarizeCheckResults(
  ctx: WorkflowStepContext,
  discovery: DiscoveredCheckRun,
): RepoAiCheckSummary {
  const artifactDirPath = join(ctx.workflow.runDirPath, "repo-ai-checks");
  mkdirSync(artifactDirPath, { recursive: true });
  if (discovery.skip) {
    const summary: RepoAiCheckSummary = {
      repo: discovery.repo,
      prNumber: discovery.prNumber,
      total: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      artifactDir: discovery.artifactDir,
      diagnostics: discovery.diagnostics,
      results: [],
    };
    writeJsonArtifact(join(artifactDirPath, "summary.json"), summary);
    return summary;
  }

  const foreachOutput = extractForeachOutput(ctx);
  const results: RecordedCheckResult[] = [];
  for (const item of foreachOutput.results.sort((a, b) => a.index - b.index)) {
    const check = discovery.checks[item.index];
    if (!check) throw new Error(`run-checks item ${item.index} has no matching discovered check`);
    const step = item.steps["run-check"];
    if (!step || step.status !== "success" || step.output === undefined) {
      throw new Error(`repo AI check "${check.name}" did not produce a successful structured output`);
    }
    const output = validateCheckAgentResult(step.output);
    const fileName = `${String(item.index + 1).padStart(2, "0")}-${artifactFilePart(check.id)}.json`;
    const artifactPath = join(discovery.artifactDir, fileName);
    writeJsonArtifact(
      join(artifactDirPath, fileName),
      buildCheckArtifact(discovery, check, output),
    );
    results.push({
      checkId: check.id,
      name: check.name,
      description: check.description,
      provenance: check.provenance,
      verdict: output.verdict,
      rationale: output.rationale,
      artifactPath,
      ...(output.suggestedFix ? { suggestedFix: output.suggestedFix } : {}),
    });
  }
  const summary: RepoAiCheckSummary = {
    repo: discovery.repo,
    prNumber: discovery.prNumber,
    total: results.length,
    pass: countVerdicts(results, "pass"),
    fail: countVerdicts(results, "fail"),
    skip: countVerdicts(results, "skip"),
    artifactDir: discovery.artifactDir,
    diagnostics: discovery.diagnostics,
    results,
  };
  writeJsonArtifact(join(artifactDirPath, "summary.json"), summary);
  return summary;
}

export function boundedCommentBody(summary: RepoAiCheckSummary): string {
  const failed = summary.results.filter((result) => result.verdict === "fail");
  const lines = [
    `**KOTA repo-local AI checks:** ${summary.fail} failed, ${summary.pass} passed, ${summary.skip} skipped.`,
    "",
    ...failed.flatMap((result) => [
      `- **${result.name}** (${result.provenance.relativePath})`,
      `  - Rationale: ${result.rationale}`,
      ...(result.suggestedFix ? [`  - Suggested fix: ${result.suggestedFix}`] : []),
    ]),
    "",
    `Artifacts: ${summary.artifactDir}`,
  ];
  const body = lines.join("\n").trim();
  if (body.length <= MAX_CHECK_COMMENT_BODY_CHARS) return body;
  const budget = MAX_CHECK_COMMENT_BODY_CHARS - CHECK_COMMENT_TRUNCATION_NOTICE.length;
  if (budget < 1) throw new Error("repo AI check comment bound is too small for the truncation notice");
  return `${body.slice(0, budget).trimEnd()}${CHECK_COMMENT_TRUNCATION_NOTICE}`;
}
