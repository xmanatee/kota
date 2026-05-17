import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import type { GitHubPullRequestEventPayload } from "#modules/github-webhook/events.js";

export const agent: AgentDef = {
  name: "pr-reviewer",
  role: "Review KOTA-created pull requests for correctness relative to the task's Done When criteria.",
  promptPath: "src/modules/autonomy/workflows/pr-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // pr-reviewer posts GitHub PR comments via `gh` and does not mutate tracked
  // files in the local worktree. Declared unrestricted because its output
  // surface is external, not repo writes.
  writeScope: [],
};

type PrWebhookPayload = Partial<GitHubPullRequestEventPayload>;

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

function assessActorIntegrity(p: PrWebhookPayload): string | null {
  if (p.actorIntegrity === "allowed") {
    return null;
  }
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

const assessPr = typedCodeStep<PrReviewAssessment>({
  id: "assess-pr",
  type: "code",
  validate: (raw): PrReviewAssessment => {
    const obj = expectStructuredOutput<{ skip: boolean }>(raw, ["skip"]);
    if (typeof obj.skip !== "boolean") {
      throw new Error(`expected skip: boolean, got ${typeof obj.skip}`);
    }
    return raw as PrReviewAssessment;
  },
  run: ({ trigger }) => {
    const p = trigger.payload as PrWebhookPayload;

    if (!isNonEmptyString(p.action) || !REVIEWABLE_ACTIONS.has(p.action)) {
      return skip(`irrelevant action '${String(p.action)}' is not reviewable`);
    }
    if (!isKotaTaskBranch(p.headBranch)) {
      return skip(`non-KOTA branch '${String(p.headBranch)}' is not a kota/task/* branch`);
    }
    if (p.isFork === true) {
      return skip("fork PR is not eligible for automated review");
    }
    if (p.isFork !== false) {
      return skip("missing explicit fork status in webhook payload");
    }
    const actorIntegritySkipReason = assessActorIntegrity(p);
    if (actorIntegritySkipReason) {
      return skip(actorIntegritySkipReason);
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

// Not recovery-capable: runs on github.pull_request webhooks, posts PR
// comments via gh, and does not touch the local worktree. It has nothing to
// reset on crash recovery and cannot heal tracked dirt left by other
// workflows.
const prReviewerWorkflow: WorkflowDefinitionInput = {
  name: "pr-reviewer",
  description: "Review KOTA-created pull requests and post structured feedback as a PR comment.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
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
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => !assessPr.outputRequired(ctx).skip,
      // The agent's prompt requires the response end with a fenced JSON
      // object containing `recommendation`; the emit step then reads that
      // recommendation off the structured step output. Without
      // outputFormat: "json" the runtime would expose the raw response
      // envelope (`{content, sessionId, ...}`) and the recommendation
      // would be unreachable, so the emit step would throw on every real
      // run. Schema-pin to the two legal verdict values so a regression
      // in either the prompt or the agent's JSON shape fails loudly at
      // step time rather than at emit time.
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["recommendation"],
        properties: {
          recommendation: {
            type: "string",
            enum: ["approve", "request-changes"],
          },
        },
      },
    },
    {
      id: "emit-review-posted",
      type: "emit",
      when: stepSucceeded("review"),
      event: "workflow.pr.review.posted",
      payload: (ctx) => {
        const assessment = assessPr.outputRequired(ctx);
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
