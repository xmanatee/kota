import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { loadConfig } from "#core/config/config.js";
import { assess, nonInteractiveConfig, type Policy } from "#core/tools/guardrails.js";
import { getToolEffect } from "#core/tools/index.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HARNESS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import type { GitHubPullRequestEventPayload } from "#modules/github-webhook/events.js";
import {
  discoverRepoAiChecks,
  type RepoAiCheckDefinition,
  type RepoAiCheckDiagnostic,
  RepoAiCheckDiscoveryError,
  type RepoAiCheckProvenance,
} from "#modules/repo-ai-checks/discovery.js";
import { repoAiChecksCompletedEvent } from "#modules/repo-ai-checks/events.js";

const CHECK_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CHECK_COMMENT_BODY_CHARS = 4_000;
const CHECK_COMMENT_TRUNCATION_NOTICE = "\n\n[Repo-local AI check summary truncated]";

export const agent: AgentDef = {
  name: "repo-ai-checker",
  role: "Run one trusted repo-local AI check against a GitHub pull request and return a structured advisory verdict.",
  promptPath: "src/modules/autonomy/workflows/repo-ai-checks/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: [],
};

type PrWebhookPayload = Partial<GitHubPullRequestEventPayload>;
type RepoAiCheckVerdict = "pass" | "fail" | "skip";

export type RepoAiCheckAgentResult = {
  verdict: RepoAiCheckVerdict;
  rationale: string;
  suggestedFix?: string;
};

type RepoAiCheckAssessment =
  | { skip: true; skipReason: string }
  | {
      skip: false;
      repo: string;
      prNumber: number;
      title: string;
      headBranch: string;
      baseBranch: string;
      headSha: string;
    };

type DiscoveredCheckRun = {
  skip: boolean;
  skipReason?: string;
  repo: string;
  prNumber: number;
  title: string;
  headBranch: string;
  baseBranch: string;
  headSha: string;
  artifactDir: string;
  checks: RepoAiCheckDefinition[];
  diagnostics: RepoAiCheckDiagnostic[];
};

type RecordedCheckResult = {
  checkId: string;
  name: string;
  description: string;
  provenance: RepoAiCheckProvenance;
  verdict: RepoAiCheckVerdict;
  rationale: string;
  artifactPath: string;
  suggestedFix?: string;
};

export type RepoAiCheckSummary = {
  repo: string;
  prNumber: number;
  total: number;
  pass: number;
  fail: number;
  skip: number;
  artifactDir: string;
  diagnostics: RepoAiCheckDiagnostic[];
  results: RecordedCheckResult[];
};

type PreparedRepoAiCheckComment = {
  repo: string;
  prNumber: number;
  body: string;
};

type RepoAiCheckCommentPolicy = {
  postAllowed: boolean;
  approvalRequired: boolean;
  policy: Policy | "unavailable";
  reason: string;
};

type CheckForeachOutput = {
  items: number;
  results: CheckForeachItemResult[];
};

type CheckForeachItemResult = {
  index: number;
  status: "success" | "failed";
  steps: {
    "run-check"?: {
      status: "success" | "failed" | "skipped";
      output?: RepoAiCheckAgentResult;
      error?: string;
    };
  };
};

const REVIEWABLE_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function skip(skipReason: string): RepoAiCheckAssessment {
  return { skip: true, skipReason };
}

function assessActorIntegrity(p: PrWebhookPayload): string | null {
  if (p.actorIntegrity === "allowed") return null;
  if (p.actorIntegrity === "blocked_actor") {
    return `blocked actor: ${p.actorIntegrityReason ?? "webhook payload marked the actor as blocked"}`;
  }
  if (p.actorIntegrity === "low_trust_actor") {
    return `low-trust actor: ${p.actorIntegrityReason ?? "webhook payload did not meet the trust threshold"}`;
  }
  if (p.actorIntegrity === "missing_metadata") {
    return `missing actor trust metadata: ${p.actorIntegrityReason ?? "webhook payload omitted actor integrity fields"}`;
  }
  return "missing actor trust metadata: webhook payload omitted actorIntegrity";
}

function isCheckVerdict(value: string): value is RepoAiCheckVerdict {
  return value === "pass" || value === "fail" || value === "skip";
}

function validateAssessment(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckAssessment>>[0],
): RepoAiCheckAssessment {
  const obj = expectStructuredOutput<RepoAiCheckAssessment>(raw, ["skip"]);
  if (typeof obj.skip !== "boolean") {
    throw new Error("repo AI check assessment skip must be boolean");
  }
  return obj;
}

function validateDiscoveredCheckRun(
  raw: Parameters<typeof expectStructuredOutput<DiscoveredCheckRun>>[0],
): DiscoveredCheckRun {
  const obj = expectStructuredOutput<DiscoveredCheckRun>(raw, [
    "skip",
    "repo",
    "prNumber",
    "checks",
    "diagnostics",
    "artifactDir",
  ]);
  if (typeof obj.skip !== "boolean") throw new Error("discover-checks skip must be boolean");
  if (!Array.isArray(obj.checks)) throw new Error("discover-checks checks must be an array");
  if (!Array.isArray(obj.diagnostics)) {
    throw new Error("discover-checks diagnostics must be an array");
  }
  return obj;
}

function validateCheckAgentResult(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckAgentResult>>[0],
): RepoAiCheckAgentResult {
  const obj = expectStructuredOutput<RepoAiCheckAgentResult>(raw, ["verdict", "rationale"]);
  if (!isCheckVerdict(obj.verdict)) {
    throw new Error("repo AI check verdict must be pass, fail, or skip");
  }
  if (!isNonEmptyString(obj.rationale)) {
    throw new Error("repo AI check rationale must be a non-empty string");
  }
  if (obj.suggestedFix !== undefined && typeof obj.suggestedFix !== "string") {
    throw new Error("repo AI check suggestedFix must be a string when present");
  }
  return {
    verdict: obj.verdict,
    rationale: obj.rationale.trim(),
    ...(obj.suggestedFix?.trim()
      ? { suggestedFix: obj.suggestedFix.trim() }
      : {}),
  };
}

function validateSummary(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckSummary>>[0],
): RepoAiCheckSummary {
  const obj = expectStructuredOutput<RepoAiCheckSummary>(raw, [
    "repo",
    "prNumber",
    "total",
    "pass",
    "fail",
    "skip",
    "artifactDir",
    "results",
  ]);
  if (!Array.isArray(obj.results)) throw new Error("repo AI check summary results must be an array");
  return obj;
}

function validatePreparedComment(
  raw: Parameters<typeof expectStructuredOutput<PreparedRepoAiCheckComment>>[0],
): PreparedRepoAiCheckComment {
  const obj = expectStructuredOutput<PreparedRepoAiCheckComment>(raw, ["repo", "prNumber", "body"]);
  if (!isNonEmptyString(obj.repo)) throw new Error("prepared repo AI check comment missing repo");
  if (typeof obj.prNumber !== "number") {
    throw new Error("prepared repo AI check comment missing PR number");
  }
  if (!isNonEmptyString(obj.body)) throw new Error("prepared repo AI check comment missing body");
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return obj;
}

function validateCommentPolicy(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckCommentPolicy>>[0],
): RepoAiCheckCommentPolicy {
  const obj = expectStructuredOutput<RepoAiCheckCommentPolicy>(raw, [
    "postAllowed",
    "approvalRequired",
    "policy",
    "reason",
  ]);
  if (typeof obj.postAllowed !== "boolean") {
    throw new Error("repo AI check comment policy postAllowed must be boolean");
  }
  if (typeof obj.approvalRequired !== "boolean") {
    throw new Error("repo AI check comment policy approvalRequired must be boolean");
  }
  if (
    obj.policy !== "allow" &&
    obj.policy !== "confirm" &&
    obj.policy !== "deny" &&
    obj.policy !== "queue" &&
    obj.policy !== "unavailable"
  ) {
    throw new Error(`repo AI check comment policy has unexpected policy ${String(obj.policy)}`);
  }
  if (!isNonEmptyString(obj.reason)) {
    throw new Error("repo AI check comment policy reason must be a non-empty string");
  }
  return obj;
}

function writeJsonArtifact(filePath: string, value: object): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function artifactFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "check";
}

function githubCommentInput(comment: PreparedRepoAiCheckComment) {
  return {
    repo: comment.repo,
    number: comment.prNumber,
    body: comment.body,
  };
}

function assessCommentPolicy(
  projectDir: string,
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
  const config = nonInteractiveConfig(loadConfig(projectDir).guardrails);
  const assessment = assess("github_comment", input, config);
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

function didStepSucceed(ctx: WorkflowStepContext, stepId: string): boolean {
  return ctx.stepResults[stepId]?.status === "success";
}

function canPostComment(ctx: WorkflowStepContext): boolean {
  if (!didStepSucceed(ctx, "prepare-comment")) return false;
  if (!didStepSucceed(ctx, "comment-policy")) return false;
  const policy = commentPolicy.outputRequired(ctx);
  return policy.postAllowed && (!policy.approvalRequired || didStepSucceed(ctx, "approve-comment"));
}

function countVerdicts(results: RecordedCheckResult[], verdict: RepoAiCheckVerdict): number {
  return results.filter((result) => result.verdict === verdict).length;
}

function buildCheckArtifact(
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
  return expectStructuredOutput<CheckForeachOutput>(ctx.stepOutputs["run-checks"], ["items", "results"]);
}

function summarizeCheckResults(ctx: WorkflowStepContext): RepoAiCheckSummary {
  const discovery = discoverChecks.outputRequired(ctx);
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

function boundedCommentBody(summary: RepoAiCheckSummary): string {
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
  if (budget < 1) {
    throw new Error("repo AI check comment bound is too small for the truncation notice");
  }
  return `${body.slice(0, budget).trimEnd()}${CHECK_COMMENT_TRUNCATION_NOTICE}`;
}

const assessPr = typedCodeStep<RepoAiCheckAssessment>({
  id: "assess-pr",
  type: "code",
  validate: validateAssessment,
  run: ({ trigger }) => {
    const p = trigger.payload as PrWebhookPayload;

    if (!isNonEmptyString(p.action) || !REVIEWABLE_ACTIONS.has(p.action)) {
      return skip(`irrelevant action '${String(p.action)}' is not reviewable`);
    }
    if (p.isFork === true) return skip("fork PR is not eligible for repo-local AI checks");
    if (p.isFork !== false) return skip("missing explicit fork status in webhook payload");
    const actorIntegritySkipReason = assessActorIntegrity(p);
    if (actorIntegritySkipReason) return skip(actorIntegritySkipReason);
    if (!isNonEmptyString(p.repo) || typeof p.number !== "number") {
      return skip("missing repo or PR number in webhook payload");
    }
    if (
      !isNonEmptyString(p.title) ||
      !isNonEmptyString(p.headBranch) ||
      !isNonEmptyString(p.baseBranch) ||
      !isNonEmptyString(p.headSha)
    ) {
      return skip("missing PR title, branches, or head SHA in webhook payload");
    }

    return {
      skip: false,
      repo: p.repo,
      prNumber: p.number,
      title: p.title,
      headBranch: p.headBranch,
      baseBranch: p.baseBranch,
      headSha: p.headSha,
    };
  },
});

const discoverChecks = typedCodeStep<DiscoveredCheckRun>({
  id: "discover-checks",
  type: "code",
  validate: validateDiscoveredCheckRun,
  when: (ctx) => !assessPr.outputRequired(ctx).skip,
  run: (ctx) => {
    const assessment = assessPr.outputRequired(ctx);
    if (assessment.skip) throw new Error("cannot discover repo AI checks for a skipped PR");
    const artifactDir = join(ctx.workflow.runDir, "repo-ai-checks");
    const artifactDirPath = join(ctx.workflow.runDirPath, "repo-ai-checks");
    mkdirSync(artifactDirPath, { recursive: true });

    if (!existsSync(ctx.projectDir)) {
      const skipped: DiscoveredCheckRun = {
        ...assessment,
        skip: true,
        skipReason: "trusted base project checkout is unavailable",
        artifactDir,
        checks: [],
        diagnostics: [],
      };
      writeJsonArtifact(join(artifactDirPath, "discovery.json"), skipped);
      return skipped;
    }

    let discovery: ReturnType<typeof discoverRepoAiChecks>;
    try {
      discovery = discoverRepoAiChecks(ctx.projectDir);
    } catch (error) {
      if (error instanceof RepoAiCheckDiscoveryError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const skipped: DiscoveredCheckRun = {
        ...assessment,
        skip: true,
        skipReason: `trusted base check discovery is unavailable: ${message}`,
        artifactDir,
        checks: [],
        diagnostics: [],
      };
      writeJsonArtifact(join(artifactDirPath, "discovery.json"), skipped);
      return skipped;
    }
    const output: DiscoveredCheckRun = {
      ...assessment,
      skip: discovery.checks.length === 0,
      ...(discovery.checks.length === 0
        ? { skipReason: "no repo-local AI check files discovered" }
        : {}),
      artifactDir,
      checks: discovery.checks,
      diagnostics: discovery.diagnostics,
    };
    writeJsonArtifact(join(artifactDirPath, "discovery.json"), output);
    return output;
  },
});

const summarizeResults = typedCodeStep<RepoAiCheckSummary>({
  id: "summarize-results",
  type: "code",
  validate: validateSummary,
  when: stepSucceeded("discover-checks"),
  run: summarizeCheckResults,
});

const prepareComment = typedCodeStep<PreparedRepoAiCheckComment>({
  id: "prepare-comment",
  type: "code",
  validate: validatePreparedComment,
  when: (ctx) => stepSucceeded("summarize-results")(ctx) && summarizeResults.outputRequired(ctx).fail > 0,
  run: (ctx) => {
    const summary = summarizeResults.outputRequired(ctx);
    const body = boundedCommentBody(summary);
    assertOutboundGitHubCommentBodyIsSafe(body);
    return {
      repo: summary.repo,
      prNumber: summary.prNumber,
      body,
    };
  },
});

const commentPolicy = typedCodeStep<RepoAiCheckCommentPolicy>({
  id: "comment-policy",
  type: "code",
  validate: validateCommentPolicy,
  when: stepSucceeded("prepare-comment"),
  run: (ctx) => {
    const comment = prepareComment.outputRequired(ctx);
    return assessCommentPolicy(ctx.projectDir, githubCommentInput(comment));
  },
});

const repoAiChecksWorkflow: WorkflowDefinitionInput = {
  name: "repo-ai-checks",
  description: "Run trusted repo-local AI check files as advisory GitHub pull-request workflow checks.",
  tags: ["monitored"],
  defaultAutonomyMode: "passive",
  runTimeoutMs: 30 * 60 * 1000,
  triggers: [
    {
      event: "github.pull_request",
    },
  ],
  steps: [
    assessPr,
    discoverChecks,
    {
      id: "run-checks",
      type: "foreach",
      as: "check",
      items: (ctx) => discoverChecks.outputRequired(ctx).checks,
      when: (ctx) => stepSucceeded("discover-checks")(ctx) && !discoverChecks.outputRequired(ctx).skip,
      maxConcurrency: 1,
      timeoutMs: 25 * 60 * 1000,
      steps: [
        {
          id: "run-check",
          type: "agent",
          agentName: agent.name,
          promptPath: agent.promptPath,
          harness: AUTONOMY_AGENT_HARNESS,
          tier: AUTONOMY_AGENT_DEFAULTS.tier,
          effort: agent.effort,
          allowedTools: ["Read", "LS", "Grep", "Glob", "github_get_pr", "github_list_prs"],
          timeoutMs: CHECK_AGENT_TIMEOUT_MS,
          maxTurns: 8,
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["verdict", "rationale"],
            additionalProperties: false,
            properties: {
              verdict: {
                type: "string",
                enum: ["pass", "fail", "skip"],
              },
              rationale: {
                type: "string",
              },
              suggestedFix: {
                type: "string",
              },
            },
          },
          validate: validateCheckAgentResult,
        },
      ],
    },
    summarizeResults,
    {
      id: "emit-summary",
      type: "emit",
      when: stepSucceeded("summarize-results"),
      event: repoAiChecksCompletedEvent.name,
      payload: (ctx) => {
        const summary = summarizeResults.outputRequired(ctx);
        return {
          repo: summary.repo,
          prNumber: summary.prNumber,
          total: summary.total,
          pass: summary.pass,
          fail: summary.fail,
          skip: summary.skip,
          artifactDir: summary.artifactDir,
        };
      },
    },
    prepareComment,
    commentPolicy,
    {
      id: "approve-comment",
      type: "approval",
      timeoutMs: COMMENT_APPROVAL_TIMEOUT_MS,
      defaultResolution: "deny",
      reason: "Approve posting one bounded advisory repo-local AI check comment to the originating GitHub pull request.",
      when: (ctx) =>
        stepSucceeded("comment-policy")(ctx) &&
        commentPolicy.outputRequired(ctx).postAllowed &&
        commentPolicy.outputRequired(ctx).approvalRequired,
    },
    {
      id: "post-comment",
      type: "tool",
      tool: "github_comment",
      when: canPostComment,
      input: (ctx) => githubCommentInput(prepareComment.outputRequired(ctx)),
    },
  ],
};

export default repoAiChecksWorkflow;
