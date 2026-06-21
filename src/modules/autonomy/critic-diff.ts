import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const GIT_MAX_BUFFER = 5 * 1024 * 1024;
const GIT_DIFF_MAX_BUFFER = 50 * 1024 * 1024;
const DIFF_CHAR_LIMIT = 80_000;

export function getStagedDiff(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--stat"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function getStagedDiffContent(projectDir: string): string {
  let diff: string;
  try {
    diff = execFileSync("git", ["diff", "--cached"], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      maxBuffer: GIT_DIFF_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "[Staged diff too large to capture — review via changed files and stat only]";
  }
  if (diff.length > DIFF_CHAR_LIMIT) {
    return `${diff.slice(0, DIFF_CHAR_LIMIT)}\n\n[... diff truncated at ${DIFF_CHAR_LIMIT / 1000}k chars ...]`;
  }
  return diff;
}

export function getChangedFiles(projectDir: string): string {
  return execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
