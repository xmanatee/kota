import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  listFullRepoTasks,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";

const SECURITY_FINDING_KEY_ATTR = "security_finding_key";
const SECURITY_REVIEW_RUNS_ATTR = "security_review_runs";

type ExistingSecurityFindingTask = {
  attrs: Record<string, string | string[]>;
  body: string;
  id: string;
  path: string;
  reviewRunIds: string[];
  state: RepoTaskState;
  superseded: boolean;
};

export type SecurityFindingTaskTarget =
  | { kind: "create"; id: string; state: "ready"; path: string }
  | ({ kind: "update" } & ExistingSecurityFindingTask);

type SecurityFindingTaskResolution = {
  current: boolean;
  key: string;
  reviewRunIds: string[];
  target: SecurityFindingTaskTarget;
};

function securityFindingKey(findingId: string, candidateId: string): string {
  const framedIdentity = `${findingId.length}:${findingId}${candidateId.length}:${candidateId}`;
  return `sha256:${createHash("sha256").update(framedIdentity).digest("hex")}`;
}

function legacyFindingIdentity(body: string): {
  findingId: string;
  candidateId: string;
} | null {
  const findingId = body.match(/^finding id: ([^\r\n]+)$/m)?.[1];
  const candidateId = body.match(/^candidate id: ([^\r\n]+)$/m)?.[1];
  return findingId && candidateId ? { findingId, candidateId } : null;
}

function reviewRunIds(
  attrs: Record<string, string | string[]>,
  body: string,
): string[] {
  const stored = attrs[SECURITY_REVIEW_RUNS_ATTR];
  const values = Array.isArray(stored)
    ? [...stored]
    : typeof stored === "string" && stored.length > 0
      ? [stored]
      : [];
  for (const match of body.matchAll(/^Created by security-review workflow run ([^\r\n]+)\.$/gm)) {
    const runId = match[1]?.trim();
    if (runId) values.push(runId);
  }
  return [...new Set(values)].sort();
}

function listMatchingSecurityFindingTasks(
  workspaceRoot: string,
  args: {
    key: string;
    persistedFindingId: string;
    persistedCandidateId: string;
  },
): ExistingSecurityFindingTask[] {
  return listFullRepoTasks(workspaceRoot).flatMap((task) => {
    const file = readVerifiedRepoTaskFile(workspaceRoot, task.state, task.id);
    if (!file) return [];
    const parsed = parseFlatFrontMatter(file.content);
    const record: ExistingSecurityFindingTask = {
      attrs: parsed.attrs,
      body: parsed.body,
      id: task.id,
      path: join(workspaceRoot, file.path),
      reviewRunIds: reviewRunIds(parsed.attrs, parsed.body),
      state: task.state,
      superseded: /^## Superseded$/m.test(parsed.body),
    };
    if (record.attrs[SECURITY_FINDING_KEY_ATTR] === args.key) return [record];
    const legacy = legacyFindingIdentity(record.body);
    return legacy?.findingId === args.persistedFindingId &&
      legacy.candidateId === args.persistedCandidateId
      ? [record]
      : [];
  });
}

function selectCanonicalSecurityFindingTask(
  matches: readonly ExistingSecurityFindingTask[],
  key: string,
): ExistingSecurityFindingTask | null {
  const canonical = matches.filter((task) => !task.superseded);
  if (canonical.length > 1) {
    throw new Error(
      `Security finding ${key} has multiple canonical task records: ${canonical.map((task) => task.id).join(", ")}`,
    );
  }
  if (canonical.length === 1) return canonical[0] ?? null;
  if (matches.length > 0) {
    throw new Error(`Security finding ${key} has superseded records but no canonical task`);
  }
  return null;
}

function nextAvailableSecurityFindingTaskTarget(
  workspaceRoot: string,
  baseId: string,
): Extract<SecurityFindingTaskTarget, { kind: "create" }> {
  const existingIds = new Set(listFullRepoTasks(workspaceRoot).map((task) => task.id));
  for (let collisionIndex = 1; ; collisionIndex += 1) {
    const id = collisionIndex === 1 ? baseId : `${baseId}-${collisionIndex}`;
    if (!existingIds.has(id)) {
      return {
        kind: "create",
        id,
        state: "ready",
        path: join(getRepoTaskStateDir(workspaceRoot, "ready"), `${id}.md`),
      };
    }
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function resolveSecurityFindingTaskTarget(
  workspaceRoot: string,
  args: {
    baseId: string;
    candidateId: string;
    findingId: string;
    persistedCandidateId: string;
    persistedFindingId: string;
    reviewRunId: string;
  },
): SecurityFindingTaskResolution {
  const key = securityFindingKey(args.findingId, args.candidateId);
  const matches = listMatchingSecurityFindingTasks(workspaceRoot, {
    key,
    persistedFindingId: args.persistedFindingId,
    persistedCandidateId: args.persistedCandidateId,
  });
  const canonical = selectCanonicalSecurityFindingTask(matches, key);
  const target = canonical
    ? { kind: "update" as const, ...canonical }
    : nextAvailableSecurityFindingTaskTarget(workspaceRoot, args.baseId);
  const mergedReviewRunIds = [
    ...new Set([
      ...matches.flatMap((task) => task.reviewRunIds),
      args.reviewRunId,
    ]),
  ].sort();
  return {
    current: target.kind === "update" &&
      target.attrs[SECURITY_FINDING_KEY_ATTR] === key &&
      sameStrings(target.reviewRunIds, mergedReviewRunIds),
    key,
    reviewRunIds: mergedReviewRunIds,
    target,
  };
}

export function securityFindingIdentityAttrs(
  key: string,
  reviewRunIds: string[],
): Record<string, string | string[]> {
  return {
    [SECURITY_FINDING_KEY_ATTR]: key,
    [SECURITY_REVIEW_RUNS_ATTR]: reviewRunIds,
  };
}
