import { execFileSync } from "node:child_process";

/** Initialize and seed a minimal Git project for integration-style tests. */
export function initGitTestProject(projectDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "t@example.com"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: projectDir,
  });
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
}
