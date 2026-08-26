import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { repoAiChecksCompletedEvent } from "#modules/repo-ai-checks/events.js";
import { discoverRepoAiChecksOperation } from "./blocking-operations.js";
import {
  assessPr,
  type DiscoveredCheckRun,
  type PreparedRepoAiCheckComment,
  type RepoAiCheckCommentPolicy,
  type RepoAiCheckSummary,
  validateCheckAgentResult,
  validateCommentPolicy,
  validateDiscoveredCheckRun,
  validatePreparedComment,
  validateSummary,
} from "./workflow-contracts.js";
import {
  assessCommentPolicy,
  boundedCommentBody,
  githubCommentInput,
  summarizeCheckResults,
} from "./workflow-results.js";

export type {
  RepoAiCheckAgentResult,
  RepoAiCheckSummary,
} from "./workflow-contracts.js";

const CHECK_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export const agent: AgentDef = {
  name: "repo-ai-checker",
  role: "Run one trusted repo-local AI check against a GitHub pull request and return a structured advisory verdict.",
  promptPath: "src/modules/autonomy/workflows/repo-ai-checks/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

function didStepSucceed(ctx: WorkflowStepContext, stepId: string): boolean {
  return ctx.stepResults[stepId]?.status === "success";
}

function canPostComment(ctx: WorkflowStepContext): boolean {
  if (!didStepSucceed(ctx, "prepare-comment")) return false;
  if (!didStepSucceed(ctx, "comment-policy")) return false;
  const policy = commentPolicy.outputRequired(ctx);
  return policy.postAllowed && (!policy.approvalRequired || didStepSucceed(ctx, "approve-comment"));
}

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
    return ctx.runBlocking(discoverRepoAiChecksOperation, {
      projectDir: ctx.projectDir,
      artifactDir,
      artifactDirPath,
      assessment,
    });
  },
});

const summarizeResults = typedCodeStep<RepoAiCheckSummary>({
  id: "summarize-results",
  type: "code",
  validate: validateSummary,
  when: stepSucceeded("discover-checks"),
  run: (ctx) => summarizeCheckResults(ctx, discoverChecks.outputRequired(ctx)),
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
  repository: "read",
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
          tier: AUTONOMY_AGENT_DEFAULTS.tier,
          effort: AUTONOMY_AGENT_DEFAULTS.effort,
          autonomyMode: "autonomous",
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
