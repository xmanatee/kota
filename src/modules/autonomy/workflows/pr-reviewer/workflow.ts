import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";

export const agent: AgentDef = {
  name: "pr-reviewer",
  role: "Review KOTA-created pull requests for correctness relative to the task's Done When criteria.",
  promptPath: "src/modules/autonomy/workflows/pr-reviewer/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

type PrWebhookPayload = {
  repo?: unknown;
  action?: unknown;
  number?: unknown;
  title?: unknown;
  headBranch?: unknown;
  baseBranch?: unknown;
  isFork?: unknown;
};

export type PrReviewAssessment =
  | { skip: true; skipReason: string }
  | {
      skip: false;
      repo: string;
      prNumber: number;
      headBranch: string;
      baseBranch: string;
      title: string;
    };

const REVIEWABLE_ACTIONS = new Set(["opened", "synchronize"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKotaTaskBranch(branch: unknown): branch is string {
  return typeof branch === "string" && branch.startsWith("kota/task/");
}

function skip(skipReason: string): PrReviewAssessment {
  return { skip: true, skipReason };
}

const assessPr = typedCodeStep<PrReviewAssessment>({
  id: "assess-pr",
  type: "code",
  run: ({ trigger }) => {
    const p = trigger.payload as PrWebhookPayload;

    if (!isNonEmptyString(p.action) || !REVIEWABLE_ACTIONS.has(p.action)) {
      return skip(`action '${String(p.action)}' is not reviewable`);
    }
    if (!isKotaTaskBranch(p.headBranch)) {
      return skip(`head branch '${String(p.headBranch)}' is not a kota/task/* branch`);
    }
    if (p.isFork === true) {
      return skip("PR is from a fork — skipping automated review");
    }
    if (p.isFork !== false) {
      return skip("missing explicit fork status in webhook payload");
    }
    if (!isNonEmptyString(p.repo) || typeof p.number !== "number") {
      return skip("missing repo or PR number in webhook payload");
    }
    if (!isNonEmptyString(p.baseBranch) || !isNonEmptyString(p.title)) {
      return skip("missing base branch or title in webhook payload");
    }

    return {
      skip: false,
      repo: p.repo,
      prNumber: p.number,
      headBranch: p.headBranch,
      baseBranch: p.baseBranch,
      title: p.title,
    };
  },
});

const prReviewerWorkflow: WorkflowDefinitionInput = {
  name: "pr-reviewer",
  description: "Review KOTA-created pull requests and post structured feedback as a PR comment.",
  triggers: [
    {
      event: "github.pull_request",
    },
  ],
  steps: [
    assessPr,
    {
      id: "review",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      timeoutMs: 20 * 60 * 1000, // 20 minutes
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => !assessPr.output(ctx).skip,
    },
    {
      id: "emit-review-posted",
      type: "emit",
      when: stepSucceeded("review"),
      event: "workflow.pr.review.posted",
      payload: (ctx) => {
        const assessment = assessPr.output(ctx);
        if (assessment.skip) {
          throw new Error("pr-reviewer cannot emit review event for skipped assessment");
        }
        const reviewOutput = ctx.stepOutputs.review as
          | { recommendation: unknown }
          | undefined;
        if (
          reviewOutput?.recommendation !== "approve" &&
          reviewOutput?.recommendation !== "request-changes"
        ) {
          throw new Error("pr-reviewer output must include recommendation: approve or request-changes");
        }
        return {
          prNumber: assessment.prNumber,
          repo: assessment.repo,
          recommendation: reviewOutput.recommendation,
        };
      },
    },
  ],
};

export default prReviewerWorkflow;
