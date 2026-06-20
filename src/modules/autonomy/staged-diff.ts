import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const STAGED_DIFF_MAX_BUFFER = 50 * 1024 * 1024;

export type FileDiff = {
  file: string;
  addedLines: string[];
  deletedLines: string[];
};

export function parseAddedLinesByFile(diff: string): FileDiff[] {
  const result: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/diff --git a\/(.+?) b\/(.+)$/);
      current = { file: match ? match[2] : "", addedLines: [], deletedLines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("+++") || rawLine.startsWith("---") || rawLine.startsWith("@@")) {
      continue;
    }
    if (rawLine.startsWith("+") && !rawLine.startsWith("++")) {
      current.addedLines.push(rawLine.slice(1));
    } else if (rawLine.startsWith("-") && !rawLine.startsWith("--")) {
      current.deletedLines.push(rawLine.slice(1));
    }
  }
  return result;
}

export function readStagedDiff(projectDir: string, pathspecs: readonly string[]): string {
  return execFileSync("git", ["diff", "--cached", "--unified=0", "--", ...pathspecs], {
    cwd: projectDir,
    encoding: "utf8",
    env: withProtectedGitBareRepositoryEnv(),
    maxBuffer: STAGED_DIFF_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
