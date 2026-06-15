import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeCanUseTools,
  createAgentCommitGuard,
  createWorkflowAgentGuards,
  isGitCommitCommand,
  isPackageBootstrapCommand,
} from "./guards.js";
import type { AgentCanUseTool, AgentPermissionResult } from "./types.js";

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

describe("isPackageBootstrapCommand", () => {
  it("detects package bootstrap and install commands", () => {
    expect(isPackageBootstrapCommand("npm install -g pnpm")).toBe(true);
    expect(isPackageBootstrapCommand("npm i")).toBe(true);
    expect(isPackageBootstrapCommand("pnpm install")).toBe(true);
    expect(isPackageBootstrapCommand("yarn add vitest")).toBe(true);
    expect(isPackageBootstrapCommand("corepack enable")).toBe(true);
  });

  it("ignores package-manager commands that do not bootstrap dependencies", () => {
    expect(isPackageBootstrapCommand("pnpm run build")).toBe(false);
    expect(isPackageBootstrapCommand("npm test")).toBe(false);
    expect(isPackageBootstrapCommand("node script.js")).toBe(false);
  });
});

describe("createAgentCommitGuard", () => {
  const options = { signal: new AbortController().signal, toolUseId: "tool-1" };

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

  it("denies Bash `git commit` invocations without aborting the session", async () => {
    const guard = createAgentCommitGuard();
    const result = await guard(
      "Bash",
      { command: "git commit -m 'msg'" },
      options,
    );
    expect(result).toMatchObject({
      behavior: "deny",
      decisionAttribution: "operator-deny",
    });
    expect(result).not.toHaveProperty("interrupt");
    if (result.behavior === "deny") {
      expect(result.message).toMatch(/git commit/);
      expect(result.message).toMatch(/commit-message\.txt/);
    }
  });

  it("denies KOTA-routed shell `git commit` invocations", async () => {
    const guard = createAgentCommitGuard();
    const result = await guard(
      "shell",
      { command: "git commit -m 'msg'" },
      options,
    );
    expect(result.behavior).toBe("deny");
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

describe("composeCanUseTools", () => {
  const options = { signal: new AbortController().signal, toolUseId: "id-1" };

  function allowGuard(update?: Record<string, unknown>): AgentCanUseTool {
    return async (_name, input): Promise<AgentPermissionResult> => ({
      behavior: "allow",
      updatedInput: update ?? input,
    });
  }

  function denyGuard(message: string): AgentCanUseTool {
    return async (): Promise<AgentPermissionResult> => ({
      behavior: "deny",
      message,
    });
  }

  it("returns an allow result with final input when every guard allows", async () => {
    const a = allowGuard();
    const b = allowGuard();
    const composed = composeCanUseTools(a, b);
    await expect(composed("Read", { x: 1 }, options)).resolves.toEqual({
      behavior: "allow",
      updatedInput: { x: 1 },
    });
  });

  it("short-circuits on the first deny", async () => {
    const denying = denyGuard("nope");
    const later = allowGuard({ mutated: true });
    const composed = composeCanUseTools(denying, later);
    const result = await composed("Read", { x: 1 }, options);
    expect(result.behavior).toBe("deny");
    if (result.behavior === "deny") expect(result.message).toBe("nope");
  });

  it("threads updated inputs through subsequent guards", async () => {
    const observed: Array<Record<string, unknown>> = [];
    const rewrite = allowGuard({ rewritten: true });
    const observe: AgentCanUseTool = async (_name, input) => {
      observed.push(input);
      return { behavior: "allow", updatedInput: input };
    };
    const composed = composeCanUseTools(rewrite, observe);
    await composed("Read", { original: true }, options);
    expect(observed).toEqual([{ rewritten: true }]);
  });

  it("degenerates to allow with original input when composed with no guards", async () => {
    const composed = composeCanUseTools();
    await expect(composed("Read", { x: 2 }, options)).resolves.toEqual({
      behavior: "allow",
      updatedInput: { x: 2 },
    });
  });
});

describe("createWorkflowAgentGuards", () => {
  const options = { signal: new AbortController().signal, toolUseId: "id-1" };

  it("denies `git commit` invocations", async () => {
    const guard = createWorkflowAgentGuards();
    const result = await guard("Bash", { command: "git commit -m msg" }, options);
    expect(result.behavior).toBe("deny");
  });

  it("denies daemon-control commands", async () => {
    const guard = createWorkflowAgentGuards();
    const result = await guard(
      "Bash",
      { command: "pnpm kota daemon stop" },
      options,
    );
    expect(result.behavior).toBe("deny");
  });

  it("denies KOTA-routed shell package bootstrap commands when no package project exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kota-no-package-"));
    try {
      const guard = createWorkflowAgentGuards();
      const result = await guard(
        "shell",
        { command: "npm install -g pnpm", cwd: dir },
        options,
      );
      expect(result.behavior).toBe("deny");
      if (result.behavior === "deny") {
      expect(result.message).toMatch(/allow-package-bootstrap/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("denies package install commands inside a package project without an opt-in marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kota-package-"));
    try {
      mkdirSync(join(dir, "fixture"));
      writeFileSync(join(dir, "package.json"), "{}\n");
      const guard = createWorkflowAgentGuards();
      const result = await guard(
        "shell",
        { command: "npm install", cwd: join(dir, "fixture") },
        options,
      );
      expect(result.behavior).toBe("deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows package install commands inside an opted-in package project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kota-package-install-"));
    try {
      mkdirSync(join(dir, ".kota"), { recursive: true });
      mkdirSync(join(dir, "fixture"));
      writeFileSync(join(dir, "package.json"), "{}\n");
      writeFileSync(join(dir, ".kota/allow-package-bootstrap"), "\n");
      const guard = createWorkflowAgentGuards();
      const result = await guard(
        "shell",
        { command: "npm install", cwd: join(dir, "fixture") },
        options,
      );
      expect(result.behavior).toBe("allow");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows benign commands", async () => {
    const guard = createWorkflowAgentGuards();
    const result = await guard("Bash", { command: "git status" }, options);
    expect(result.behavior).toBe("allow");
  });
});
