import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";

export async function getIdleEventSignature(
  projectDir: string,
): Promise<string> {
  const worktree = await getRepoWorktreeStatusAsync(projectDir);
  return [
    "project",
    worktree.available ? "git" : "no-git",
    worktree.headSha,
    worktree.fingerprint,
  ].join("\0");
}
