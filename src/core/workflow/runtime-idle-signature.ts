import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";

export async function getIdleEventSignature(
  repoRoot: string,
): Promise<string> {
  const worktree = await getRepoWorktreeStatusAsync(repoRoot);
  return [
    "scope",
    worktree.available ? "git" : "no-git",
    worktree.headSha,
    worktree.fingerprint,
  ].join("\0");
}
