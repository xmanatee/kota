import { execFileSync } from "node:child_process";

export type RepoWorktreeStatus = {
  available: boolean;
  dirty: boolean;
  entries: string[];
  fingerprint: string;
  summary: string;
  headSha: string;
};

export function getRepoHeadSha(projectDir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function summarizeEntries(entries: string[]): string {
  if (entries.length === 0) {
    return "clean";
  }
  const shown = entries.slice(0, 5);
  const suffix =
    entries.length > shown.length ? ` (+${entries.length - shown.length} more)` : "";
  return `${shown.join(", ")}${suffix}`;
}

export function getRepoWorktreeStatus(projectDir: string): RepoWorktreeStatus {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: projectDir, encoding: "utf8" },
    ).trim();
    const entries = output ? output.split("\n").map((line) => line.trim()) : [];
    return {
      available: true,
      dirty: entries.length > 0,
      entries,
      fingerprint: entries.join("\n"),
      summary: summarizeEntries(entries),
      headSha: getRepoHeadSha(projectDir),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      dirty: false,
      entries: [],
      fingerprint: "",
      summary: `git status unavailable: ${message}`,
      headSha: "",
    };
  }
}

export function assertRepoWorktreeClean(projectDir: string): RepoWorktreeStatus {
  const status = getRepoWorktreeStatus(projectDir);
  if (status.available && status.dirty) {
    throw new Error(`Repository worktree must be clean before starting a new autonomous run: ${status.summary}`);
  }
  return status;
}
