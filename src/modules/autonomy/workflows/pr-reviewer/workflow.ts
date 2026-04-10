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
  repo: string | null;
  action: string | null;
  number: number | null;
  title: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  isFork: boolean | null;
};

export type PrReviewAssessment = {
  skip: boolean;
  skipReason?: string;
  repo: string;
  prNumber: number;
  headBranch: string;
  baseBranch: string;
  title: string;
};

const REVIEWABLE_ACTIONS = new Set(["opened", "synchronize"]);

function isKotaTaskBranch(branch: string | null): branch is string {
  return typeof branch === "string" && branch.startsWith("kota/task/");
}

const assessPr = typedCodeStep<PrReviewAssessment>({
  id: "assess-pr",
  type: "code",
  run: ({ trigger }) => {
    const p = trigger.payload as PrWebhookPayload;

    const base: Omit<PrReviewAssessment, "skip"> = {
      repo: p.repo ?? "",
      prNumber: p.number ?? 0,
      headBranch: p.headBranch ?? "",
      baseBranch: p.baseBranch ?? "main",
      title: p.title ?? "",
    };

    if (!REVIEWABLE_ACTIONS.has(p.action ?? "")) {
      return { skip: true, skipReason: `action '${p.action}' is not reviewable`, ...base };
    }

    if (!isKotaTaskBranch(p.headBranch)) {
      return { skip: true, skipReason: `head branch '${p.headBranch}' is not a kota/task/* branch`, ...base };
    }

    if (p.isFork === true) {
      return { skip: true, skipReason: "PR is from a fork — skipping automated review", ...base };
    }

    if (!p.repo || p.number == null) {
      return { skip: true, skipReason: "missing repo or PR number in webhook payload", ...base };
    }

    return {
      skip: false,
      repo: p.repo,
      prNumber: p.number,
      headBranch: p.headBranch,
      baseBranch: p.baseBranch ?? "main",
      title: p.title ?? "",
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
        const reviewOutput = ctx.stepOutputs["review"] as
          | { recommendation?: string }
          | undefined;
        return {
          prNumber: assessment.prNumber,
          repo: assessment.repo,
          recommendation: reviewOutput?.recommendation ?? "unknown",
        };
      },
    },
  ],
};

export default prReviewerWorkflow;
