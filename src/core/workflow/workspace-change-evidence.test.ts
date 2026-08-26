import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readWorkspaceChangeEvidence,
  WorkspaceChangeCommandError,
} from "./workspace-change-evidence.js";

function git(workspaceRoot: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeProjectFile(workspaceRoot: string, path: string, content: string): void {
  const absolutePath = join(workspaceRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

describe("readWorkspaceChangeEvidence", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-workspace-change-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    git(workspaceRoot, "init", "-q", "-b", "main");
    git(workspaceRoot, "config", "user.email", "test@example.com");
    git(workspaceRoot, "config", "user.name", "Test");
    git(workspaceRoot, "config", "commit.gpgsign", "false");
    writeProjectFile(workspaceRoot, "modified.ts", "export const value = 1;\n");
    writeProjectFile(workspaceRoot, "deleted.ts", "export const removed = true;\n");
    git(workspaceRoot, "add", "modified.ts", "deleted.ts");
    git(workspaceRoot, "commit", "-q", "-m", "seed");
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns typed changes plus diff and stat for tracked and untracked workspace content", () => {
    writeProjectFile(workspaceRoot, "modified.ts", "export const value = 2;\n");
    rmSync(join(workspaceRoot, "deleted.ts"));
    writeProjectFile(workspaceRoot, "new.ts", "export const created = true;\n");

    const evidence = readWorkspaceChangeEvidence(workspaceRoot);

    expect(evidence.changes).toEqual([
      { path: "deleted.ts", status: "deleted", tracked: true },
      { path: "modified.ts", status: "modified", tracked: true },
      { path: "new.ts", status: "added", tracked: false },
    ]);
    expect(evidence.diff).toMatchObject({ truncated: false });
    expect(evidence.diff.text).toContain("-export const value = 1;");
    expect(evidence.diff.text).toContain("+export const value = 2;");
    expect(evidence.diff.text).toContain("+export const created = true;");
    expect(evidence.stat).toMatchObject({ truncated: false });
    expect(evidence.stat.text).toContain("modified.ts");
    expect(evidence.stat.text).toContain("new.ts");
    expect(git(workspaceRoot, "diff", "--cached", "--name-only")).toBe("");
    expect(git(workspaceRoot, "ls-files", "--others", "--exclude-standard", "-z")).toBe(
      "new.ts\0",
    );
  });

  it("preserves awkward tracked and untracked filenames", () => {
    const trackedPath = "src/tracked\tname\nfile.ts";
    const untrackedPath = "src/untracked\tname\nfile.ts";
    writeProjectFile(workspaceRoot, trackedPath, "export const before = true;\n");
    git(workspaceRoot, "add", trackedPath);
    git(workspaceRoot, "commit", "-q", "-m", "add awkward tracked path");
    writeProjectFile(workspaceRoot, trackedPath, "export const after = true;\n");
    writeProjectFile(workspaceRoot, untrackedPath, "export const added = true;\n");

    const evidence = readWorkspaceChangeEvidence(workspaceRoot, {
      pathspecs: ["src"],
    });

    expect(evidence.changes).toEqual([
      { path: trackedPath, status: "modified", tracked: true },
      { path: untrackedPath, status: "added", tracked: false },
    ]);
  });

  it("reports size truncation without turning it into a command failure", () => {
    writeProjectFile(
      workspaceRoot,
      "large.ts",
      Array.from({ length: 200 }, (_, index) => `export const value${index} = ${index};`).join(
        "\n",
      ),
    );

    const evidence = readWorkspaceChangeEvidence(workspaceRoot, {
      limits: { diffBytes: 128 },
    });

    expect(evidence.diff).toMatchObject({ truncated: true, limitBytes: 128 });
    expect(Buffer.byteLength(evidence.diff.text)).toBeLessThanOrEqual(128);
  });

  it("throws a typed command error for a real Git failure", () => {
    const notARepository = join(
      tmpdir(),
      `kota-not-a-repository-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      mkdirSync(notARepository);
      expect(() => readWorkspaceChangeEvidence(notARepository)).toThrow(
        WorkspaceChangeCommandError,
      );
    } finally {
      rmSync(notARepository, { recursive: true, force: true });
    }
  });
});
