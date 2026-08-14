import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";

export async function getIdleEventSignature(
  projectDir: string,
  workspaceDir: string,
): Promise<string> {
  const worktrees = await Promise.all(
    workspaceDir === projectDir
      ? [getRepoWorktreeStatusAsync(projectDir)]
      : [
          getRepoWorktreeStatusAsync(projectDir),
          getRepoWorktreeStatusAsync(workspaceDir),
        ],
  );
  const worktree = worktrees[0]!;
  const workspaceWorktree = worktrees[1] ?? worktree;
  return [
    "project",
    worktree.available ? "git" : "no-git",
    worktree.headSha,
    worktree.fingerprint,
    "workspace",
    workspaceWorktree.available ? "git" : "no-git",
    workspaceWorktree.headSha,
    workspaceWorktree.fingerprint,
  ].join("\0");
}
