import { spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readGitTextTree } from "#core/util/repository-tree.js";
import {
  listRepoTasksFromTree,
  REPO_INBOX_DIR,
  REPO_TASKS_DIR,
  type RepoTaskFullRecord,
  type RepoTaskQueueSnapshot,
  summarizeRepoTaskQueue,
} from "./repo-tasks-domain.js";
import { assertTaskQueueValid } from "./task-queue-validation.js";

export type PublishedRepoTaskQueue = {
  tasks: readonly RepoTaskFullRecord[];
  queue: RepoTaskQueueSnapshot;
};

function hasUnbornHead(repoRoot: string): boolean {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: repoRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    return result;
  };
  if (git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).status !== 1) return false;
  const branch = git(["symbolic-ref", "--quiet", "HEAD"]);
  if (branch.status !== 0) return false;
  // Only a missing symbolic branch is unpublished; detached/corrupt HEAD still fails intake.
  return git(["show-ref", "--verify", "--quiet", branch.stdout.trim()]).status === 1;
}

export function readPublishedRepoTaskQueue(repoRoot: string): PublishedRepoTaskQueue {
  if (hasUnbornHead(repoRoot)) return { tasks: [], queue: summarizeRepoTaskQueue([], 0, "") };
  const { revision, tree } = readGitTextTree(repoRoot, "HEAD", [REPO_TASKS_DIR, REPO_INBOX_DIR]);
  if (revision === null) throw new Error("Task dispatch requires a committed Git HEAD snapshot");
  assertTaskQueueValid(repoRoot, tree);
  const tasks = listRepoTasksFromTree(tree);
  const inbox = tree.list(REPO_INBOX_DIR).filter(({ name }) => name !== "AGENTS.md" && name.endsWith(".md"));
  for (const entry of inbox) {
    if (entry.kind !== "file") throw new Error(`Published inbox entry must be a regular file: ${entry.name}`);
  }
  return { tasks, queue: summarizeRepoTaskQueue(tasks, inbox.length, revision) };
}
