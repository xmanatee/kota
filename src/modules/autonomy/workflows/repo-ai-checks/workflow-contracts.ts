import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import type { GitHubPullRequestEventPayload } from "#modules/github-webhook/events.js";
import type {
  RepoAiCheckDefinition,
  RepoAiCheckDiagnostic,
  RepoAiCheckProvenance,
} from "#modules/repo-ai-checks/discovery.js";

type PrWebhookPayload = Partial<GitHubPullRequestEventPayload>;
export type RepoAiCheckVerdict = "pass" | "fail" | "skip";

export type RepoAiCheckAgentResult = {
  verdict: RepoAiCheckVerdict;
  rationale: string;
  suggestedFix?: string;
};

export type RepoAiCheckAssessment =
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

export type DiscoveredCheckRun = {
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

export type RecordedCheckResult = {
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

export type PreparedRepoAiCheckComment = {
  repo: string;
  prNumber: number;
  body: string;
};

export type RepoAiCheckCommentPolicy = {
  postAllowed: boolean;
  approvalRequired: boolean;
  policy: "allow" | "confirm" | "deny" | "queue" | "unavailable";
  reason: string;
};

export type CheckForeachOutput = {
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

export function isNonEmptyString(
  value: string | null | undefined,
): value is string {
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

export function validateDiscoveredCheckRun(
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
  if (!Array.isArray(obj.diagnostics)) throw new Error("discover-checks diagnostics must be an array");
  return obj;
}

export function validateCheckAgentResult(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckAgentResult>>[0],
): RepoAiCheckAgentResult {
  const obj = expectStructuredOutput<RepoAiCheckAgentResult>(raw, ["verdict", "rationale"]);
  if (!isCheckVerdict(obj.verdict)) throw new Error("repo AI check verdict must be pass, fail, or skip");
  if (!isNonEmptyString(obj.rationale)) throw new Error("repo AI check rationale must be a non-empty string");
  if (obj.suggestedFix !== undefined && typeof obj.suggestedFix !== "string") {
    throw new Error("repo AI check suggestedFix must be a string when present");
  }
  return {
    verdict: obj.verdict,
    rationale: obj.rationale.trim(),
    ...(obj.suggestedFix?.trim() ? { suggestedFix: obj.suggestedFix.trim() } : {}),
  };
}

export function validateSummary(
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

export function validatePreparedComment(
  raw: Parameters<typeof expectStructuredOutput<PreparedRepoAiCheckComment>>[0],
): PreparedRepoAiCheckComment {
  const obj = expectStructuredOutput<PreparedRepoAiCheckComment>(raw, ["repo", "prNumber", "body"]);
  if (!isNonEmptyString(obj.repo)) throw new Error("prepared repo AI check comment missing repo");
  if (typeof obj.prNumber !== "number") throw new Error("prepared repo AI check comment missing PR number");
  if (!isNonEmptyString(obj.body)) throw new Error("prepared repo AI check comment missing body");
  assertOutboundGitHubCommentBodyIsSafe(obj.body);
  return obj;
}

export function validateCommentPolicy(
  raw: Parameters<typeof expectStructuredOutput<RepoAiCheckCommentPolicy>>[0],
): RepoAiCheckCommentPolicy {
  const obj = expectStructuredOutput<RepoAiCheckCommentPolicy>(raw, [
    "postAllowed",
    "approvalRequired",
    "policy",
    "reason",
  ]);
  if (typeof obj.postAllowed !== "boolean") throw new Error("repo AI check comment policy postAllowed must be boolean");
  if (typeof obj.approvalRequired !== "boolean") throw new Error("repo AI check comment policy approvalRequired must be boolean");
  if (!new Set(["allow", "confirm", "deny", "queue", "unavailable"]).has(obj.policy)) {
    throw new Error(`repo AI check comment policy has unexpected policy ${String(obj.policy)}`);
  }
  if (!isNonEmptyString(obj.reason)) throw new Error("repo AI check comment policy reason must be a non-empty string");
  return obj;
}

export const assessPr = typedCodeStep<RepoAiCheckAssessment>({
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
