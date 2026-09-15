import { execFileSync } from "node:child_process";
import { z } from "zod";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowPostReconcileInvariant } from "#core/workflow/types.js";
import { listResearchRetryCandidates } from "./candidates.js";
import { researchRetryCapabilitySchema } from "./precondition.js";
import { sourceEvidenceSchema } from "./source-evidence.js";

// The runtime persists the screened collection output and the child trigger.
// No browser session or credential crosses into the repository writer.
export const researchHandoffSchema = z.object({
  scopeId: z.string().min(1),
  sourceRunId: z.string().min(1),
  candidate: z.object({
    id: z.string().regex(/^task-[a-z0-9-]+$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    urls: z.array(z.url()),
    attemptableUrls: z.array(z.url()).min(1),
  }),
  capability: researchRetryCapabilitySchema,
  evidence: sourceEvidenceSchema,
}).superRefine((value, ctx) => {
  const urls = value.candidate.attemptableUrls;
  if (urls.some((url) => !value.candidate.urls.includes(url)) ||
    value.evidence.attempts.length !== urls.length ||
    value.evidence.sources.length !== urls.length ||
    urls.some((url, index) => value.evidence.attempts[index]?.url !== url || value.evidence.sources[index]?.url !== url)) {
    ctx.addIssue({ code: "custom", message: "Collected evidence does not match the selected sources" });
  }
});
export type ResearchHandoff = z.infer<typeof researchHandoffSchema>;

export function researchContractMatches(workspaceRoot: string, handoff: ResearchHandoff): boolean {
  return listResearchRetryCandidates(workspaceRoot).some((candidate) =>
    candidate.id === handoff.candidate.id && candidate.digest === handoff.candidate.digest);
}

export const verifyResearchContract: WorkflowPostReconcileInvariant = (input) => {
  input.signal.throwIfAborted();
  // A stale handoff can safely retire only when the writer publishes no changes.
  // Compare writer changes against the merge base, excluding canonical-only edits.
  const changes = execFileSync("git", [
    "diff", "--no-ext-diff", "--name-only", "-z", `${input.canonicalHead}...${input.head}`, "--",
  ], { cwd: input.workspaceRoot, env: withProtectedGitBareRepositoryEnv(), encoding: "utf8" });
  if (changes.length === 0) return { satisfied: true };
  const handoff = researchHandoffSchema.parse(input.trigger.payload);
  return researchContractMatches(input.repoRoot, handoff)
    ? { satisfied: true }
    : { satisfied: false, reason: `Research task ${handoff.candidate.id} changed after source collection` };
};
