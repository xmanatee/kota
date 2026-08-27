import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskContainerDir,
  listFullRepoTasks,
  type RepoTaskPriority,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";

type ExistingSecurityFindingTask = {
  body: string;
  id: string;
  path: string;
  priority: RepoTaskPriority | null;
  reviewRunIds: string[];
  state: RepoTaskState;
  superseded: boolean;
};

export type SecurityFindingTaskTarget =
  | { kind: "create"; id: string; state: "open"; path: string }
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

function reviewRunIds(body: string): string[] {
  const values: string[] = [];
  for (const match of body.matchAll(/^Created by security-review workflow run ([^\r\n]+)\.$/gm)) {
    const runId = match[1]?.trim();
    if (runId) values.push(runId);
  }
  const confirmed = body.match(
    /^Confirmed by security-review workflow runs:\s*\n((?:\s*- [^\r\n]+\s*\n?)+)/m,
  )?.[1];
  for (const line of confirmed?.split(/\r?\n/) ?? []) {
    const runId = line.match(/^\s*-\s+(.+?)\s*$/)?.[1];
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
      body: parsed.body,
      id: task.id,
      path: join(workspaceRoot, file.path),
      priority: task.priority,
      reviewRunIds: reviewRunIds(parsed.body),
      state: task.state,
      superseded: /^## Superseded$/m.test(parsed.body),
    };
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
        state: "open",
        path: join(getRepoTaskContainerDir(workspaceRoot, "open"), `${id}.md`),
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
    current: target.kind === "update" && sameStrings(target.reviewRunIds, mergedReviewRunIds),
    key,
    reviewRunIds: mergedReviewRunIds,
    target,
  };
}
