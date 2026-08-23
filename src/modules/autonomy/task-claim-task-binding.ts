import { createHash } from "node:crypto";
import {
  parseFlatFrontMatter,
  serializeFlatFrontMatter,
} from "#core/util/frontmatter.js";

const TASK_CLAIM_CONTENT_DIGEST = /^[a-f0-9]{64}$/;

export function taskClaimContentDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Bind a claim to the task contract while allowing the canonical task mover
 * to rewrite lifecycle-only frontmatter during ready -> doing.
 */
export function taskClaimContractDigest(content: string): string {
  const { attrs, body } = parseFlatFrontMatter(content);
  const stableAttrs = { ...attrs };
  delete stableAttrs.status;
  delete stableAttrs.updated_at;
  const stableContent = serializeFlatFrontMatter(stableAttrs, body);
  return createHash("sha256").update(stableContent, "utf8").digest("hex");
}

export function isCanonicalTaskContent(content: string): boolean {
  const { attrs, body } = parseFlatFrontMatter(content);
  return serializeFlatFrontMatter(attrs, body) === content;
}

export function isTaskClaimContentDigest(value: string | undefined): value is string {
  return typeof value === "string" && TASK_CLAIM_CONTENT_DIGEST.test(value);
}
