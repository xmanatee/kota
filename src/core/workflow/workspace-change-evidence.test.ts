import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readWorkspaceChangeEvidence,
  WorkspaceChangeCommandError,
} from "./workspace-change-evidence.js";

function git(projectDir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeProjectFile(projectDir: string, path: string, content: string): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

describe("readWorkspaceChangeEvidence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-workspace-change-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    git(projectDir, "init", "-q", "-b", "main");
    git(projectDir, "config", "user.email", "test@example.com");
    git(projectDir, "config", "user.name", "Test");
    git(projectDir, "config", "commit.gpgsign", "false");
    writeProjectFile(projectDir, "modified.ts", "export const value = 1;\n");
    writeProjectFile(projectDir, "deleted.ts", "export const removed = true;\n");
    git(projectDir, "add", "modified.ts", "deleted.ts");
    git(projectDir, "commit", "-q", "-m", "seed");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns typed changes plus diff and stat for tracked and untracked workspace content", () => {
    writeProjectFile(projectDir, "modified.ts", "export const value = 2;\n");
    rmSync(join(projectDir, "deleted.ts"));
    writeProjectFile(projectDir, "new.ts", "export const created = true;\n");

    const evidence = readWorkspaceChangeEvidence(projectDir);

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
    expect(git(projectDir, "diff", "--cached", "--name-only")).toBe("");
    expect(git(projectDir, "ls-files", "--others", "--exclude-standard", "-z")).toBe(
      "new.ts\0",
    );
  });

  it("preserves awkward tracked and untracked filenames", () => {
    const trackedPath = "src/tracked\tname\nfile.ts";
    const untrackedPath = "src/untracked\tname\nfile.ts";
    writeProjectFile(projectDir, trackedPath, "export const before = true;\n");
    git(projectDir, "add", trackedPath);
    git(projectDir, "commit", "-q", "-m", "add awkward tracked path");
    writeProjectFile(projectDir, trackedPath, "export const after = true;\n");
    writeProjectFile(projectDir, untrackedPath, "export const added = true;\n");

    const evidence = readWorkspaceChangeEvidence(projectDir, {
      pathspecs: ["src"],
    });

    expect(evidence.changes).toEqual([
      { path: trackedPath, status: "modified", tracked: true },
      { path: untrackedPath, status: "added", tracked: false },
    ]);
  });

  it("reports size truncation without turning it into a command failure", () => {
    writeProjectFile(
      projectDir,
      "large.ts",
      Array.from({ length: 200 }, (_, index) => `export const value${index} = ${index};`).join(
        "\n",
      ),
    );

    const evidence = readWorkspaceChangeEvidence(projectDir, {
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
