import { describe, expect, it } from "vitest";
import { createAgentCommitGuard, isGitCommitCommand } from "./agent-commit-guard.js";

describe("isGitCommitCommand", () => {
  it("detects direct `git commit` variants", () => {
    expect(isGitCommitCommand("git commit")).toBe(true);
    expect(isGitCommitCommand("git commit -m 'msg'")).toBe(true);
    expect(isGitCommitCommand('git commit -m "msg"')).toBe(true);
    expect(isGitCommitCommand("git commit --amend")).toBe(true);
    expect(isGitCommitCommand("git commit -a -m msg")).toBe(true);
    expect(isGitCommitCommand("git commit --no-verify -m msg")).toBe(true);
  });

  it("detects `git commit` after shell separators", () => {
    expect(isGitCommitCommand("git add -A && git commit -m msg")).toBe(true);
    expect(isGitCommitCommand("cd foo; git commit")).toBe(true);
    expect(isGitCommitCommand("true | git commit")).toBe(true);
    expect(isGitCommitCommand("(git commit -m msg)")).toBe(true);
  });

  it("detects `git -C <path> commit` plumbing variants", () => {
    expect(isGitCommitCommand("git -C /tmp/project commit")).toBe(true);
    expect(isGitCommitCommand("git -C . commit -m msg")).toBe(true);
  });

  it("ignores commands that are not git commit", () => {
    expect(isGitCommitCommand("git status")).toBe(false);
    expect(isGitCommitCommand("git log --oneline")).toBe(false);
    expect(isGitCommitCommand("git push origin main")).toBe(false);
    expect(isGitCommitCommand("git add -A")).toBe(false);
    expect(isGitCommitCommand("git diff --staged")).toBe(false);
    expect(isGitCommitCommand("git rev-parse HEAD")).toBe(false);
  });

  it("does not match tokens that merely contain `commit`", () => {
    expect(isGitCommitCommand("git log --grep=commit")).toBe(false);
    expect(isGitCommitCommand("echo my-commit")).toBe(false);
    expect(isGitCommitCommand("git show commit-msg")).toBe(false);
    expect(isGitCommitCommand("git push origin mycommit")).toBe(false);
  });

  it("handles whitespace normalization and empty commands", () => {
    expect(isGitCommitCommand("  ")).toBe(false);
    expect(isGitCommitCommand("")).toBe(false);
    expect(isGitCommitCommand("git  commit")).toBe(true);
    expect(isGitCommitCommand("git commit\\\n -m msg")).toBe(true);
  });
});

describe("createAgentCommitGuard", () => {
  const options = { signal: new AbortController().signal, toolUseID: "tool-1" };

  it("allows non-Bash tool calls", async () => {
    const guard = createAgentCommitGuard();
    await expect(
      guard("Read", { file_path: "src/index.ts" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "src/index.ts" },
    });
  });

  it("allows benign Bash commands", async () => {
    const guard = createAgentCommitGuard();
    await expect(
      guard("Bash", { command: "git status" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
    });
  });

  it("denies Bash `git commit` invocations with an interrupt", async () => {
    const guard = createAgentCommitGuard();
    const result = await guard(
      "Bash",
      { command: "git commit -m 'msg'" },
      options,
    );
    expect(result).toMatchObject({
      behavior: "deny",
      interrupt: true,
      decisionClassification: "user_reject",
    });
    if (result.behavior === "deny") {
      expect(result.message).toMatch(/git commit/);
      expect(result.message).toMatch(/commit-message\.txt/);
    }
  });

  it("denies when `git commit` is chained with other commands", async () => {
    const guard = createAgentCommitGuard();
    const result = await guard(
      "Bash",
      { command: "git add -A && git commit -m fix" },
      options,
    );
    expect(result.behavior).toBe("deny");
  });
});
