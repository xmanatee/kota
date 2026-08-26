import { execFileSync } from "node:child_process";

/** Initialize and seed a minimal Git repository for integration-style tests. */
export function initGitTestRepository(repoRoot: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "t@example.com"], {
    cwd: repoRoot,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repoRoot });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: repoRoot,
  });
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "seed"], {
    cwd: repoRoot,
  });
}
