import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { networkReadEffect } from "#core/tools/effect.js";
import type { GitHubFetch } from "./github-auth.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const repoName = z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
  .refine((value) => ![".", ".."].includes(value.split("/")[1]));
const MAX_REVIEW_CHARS = 80_000;

export const prReviewIdentitySchema = z.object({
  repo: repoName,
  number: z.number().int().positive(),
  headSha: sha,
  baseSha: sha,
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  title: z.string().min(1),
  body: z.string().nullable(),
});
const unavailableEvidenceSchema = z.object({ status: z.literal("unavailable"), reason: z.string().min(1) });
export const prReviewIdentityResultSchema = z.union([prReviewIdentitySchema, unavailableEvidenceSchema]);
export const prReviewEvidenceSchema = z.discriminatedUnion("status", [
  prReviewIdentitySchema.extend({ status: z.literal("ready"), diff: z.string().min(1).max(MAX_REVIEW_CHARS) }),
  unavailableEvidenceSchema,
]);
export type PrReviewEvidence = z.infer<typeof prReviewEvidenceSchema>;

const prRef = z.object({
  sha,
  ref: z.string().min(1),
  repo: z.object({ full_name: repoName }).nullable(),
});
const pullRequest = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  title: z.string().min(1),
  body: z.string().nullable(),
  head: prRef,
  base: prRef,
});

function unavailable(reason: string) {
  return { content: JSON.stringify({ status: "unavailable", reason }) };
}

export function makeGetPrReview(token: string, defaultRepo: string | null, fetch: GitHubFetch): ToolDef {
  return {
    effect: networkReadEffect(),
    tool: {
      name: "github_get_pr_review",
      description: "Read a same-repository PR's raw diff and intent pinned to headSha, or only its current identity for freshness checks. Reports unavailable coverage instead of silently truncating or approving missing evidence.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo; defaults to configured repository" },
          number: { type: "integer", minimum: 1 },
          headSha: { type: "string", pattern: "^[a-f0-9]{40}$" },
          mode: { type: "string", enum: ["evidence", "identity"], description: "Defaults to evidence; identity does not download the diff." },
        },
        required: ["number", "headSha"],
        additionalProperties: false,
      },
    },
    async runner(input) {
      const coordinates = z.object({
        repo: repoName, number: z.number().int().positive(), headSha: sha,
        mode: z.enum(["evidence", "identity"]).default("evidence"),
      }).parse({ ...input, repo: input.repo ?? defaultRepo });
      const { repo, number, headSha, mode } = coordinates;
      const path = `/repos/${repo}/pulls/${number}`;
      const read = async (representation: "json" | "diff" = "json") => {
        const result = await fetch(token, "GET", path, undefined, undefined, representation);
        // Transport policy and cancellation exceptions propagate unchanged. Never echo provider bodies.
        if (result.status === 401 || result.status === 403) {
          throw new Error(`GitHub PR review read not authorized (HTTP ${result.status})`);
        }
        return result;
      };
      const metadata = await read();
      if (!metadata.ok) return unavailable(`PR metadata unavailable (HTTP ${metadata.status})`);
      const before = pullRequest.parse(metadata.data);
      if (before.state !== "open" || before.number !== number || before.head.sha !== headSha ||
        before.head.repo?.full_name.toLowerCase() !== repo.toLowerCase() ||
        before.base.repo?.full_name.toLowerCase() !== repo.toLowerCase()) {
        return unavailable("PR is closed, stale, or no longer same-repository");
      }
      const identity = prReviewIdentitySchema.parse({
        repo, number, headSha, baseSha: before.base.sha,
        headBranch: before.head.ref, baseBranch: before.base.ref,
        title: before.title, body: before.body,
      });
      if (mode === "identity") return { content: JSON.stringify(identity) };

      const diffResponse = await read("diff");
      if (!diffResponse.ok) return unavailable(`PR diff unavailable (HTTP ${diffResponse.status})`);
      const diff = z.string().parse(diffResponse.data);
      if (!diff.startsWith("diff --git ") || JSON.stringify({ ...identity, diff }).length > MAX_REVIEW_CHARS) {
        return unavailable("PR diff is missing or exceeds the review input limit");
      }
      // Raw diffs retain rename/mode-only headers, but do not expose binary contents for review.
      if (/^(?:Binary files .+ differ|GIT binary patch)$/m.test(diff)) {
        return unavailable("PR diff includes binary content that cannot be reviewed from text evidence");
      }
      const finalMetadata = await read();
      if (!finalMetadata.ok) return unavailable(`PR freshness unavailable (HTTP ${finalMetadata.status})`);
      const after = pullRequest.parse(finalMetadata.data);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        return unavailable("PR changed while collecting review evidence");
      }
      return { content: JSON.stringify(prReviewEvidenceSchema.parse({ status: "ready", ...identity, diff })) };
    },
  };
}
