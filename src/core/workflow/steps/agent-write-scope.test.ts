import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "../run-types.js";
import {
  AgentWriteScopeViolationError,
  findWriteScopeViolations,
  listMutatedTrackedFiles,
  pathInScope,
  writeWriteScopeViolationArtifact,
} from "./agent-write-scope.js";

describe("pathInScope", () => {
  it("admits every path when scope is empty (unrestricted)", () => {
    expect(pathInScope("src/core/workflow/types.ts", [])).toBe(true);
    expect(pathInScope("data/tasks/ready/task-x.md", [])).toBe(true);
    expect(pathInScope("package.json", [])).toBe(true);
  });

  it("admits a path that equals a scope entry exactly (file case)", () => {
    expect(pathInScope("data/watchlist.yaml", ["data/watchlist.yaml"])).toBe(
      true,
    );
  });

  it("admits a path that lives under a directory scope entry", () => {
    expect(pathInScope("data/tasks/ready/task-x.md", ["data/tasks/"])).toBe(
      true,
    );
    // Trailing slash should be optional.
    expect(pathInScope("data/tasks/ready/task-x.md", ["data/tasks"])).toBe(
      true,
    );
  });

  it("rejects a path outside every scope entry", () => {
    expect(pathInScope("src/core/foo.ts", ["data/tasks/"])).toBe(false);
    // Avoid the classic prefix bug: "data/tasks-other" must not match "data/tasks".
    expect(pathInScope("data/tasks-other/x.md", ["data/tasks/"])).toBe(false);
  });
});

describe("findWriteScopeViolations", () => {
  it("returns [] when scope is unrestricted even if mutations exist", () => {
    expect(
      findWriteScopeViolations(
        ["src/core/workflow/types.ts", "data/tasks/ready/task.md"],
        [],
      ),
    ).toEqual([]);
  });

  it("returns [] when every mutation is in scope", () => {
    expect(
      findWriteScopeViolations(
        ["data/tasks/ready/a.md", "data/watchlist.yaml"],
        ["data/tasks/", "data/watchlist.yaml"],
      ),
    ).toEqual([]);
  });

  it("reports every out-of-scope mutation, sorted", () => {
    expect(
      findWriteScopeViolations(
        [
          "src/core/foo.ts",
          "data/tasks/ready/a.md",
          "AGENTS.md",
          "docs/overview.md",
        ],
        ["data/tasks/"],
      ),
    ).toEqual(["AGENTS.md", "docs/overview.md", "src/core/foo.ts"]);
  });
});

describe("listMutatedTrackedFiles", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-write-scope-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: projectDir,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: projectDir,
    });
    writeFileSync(join(projectDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: projectDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns [] when the tree is clean", () => {
    expect(listMutatedTrackedFiles(projectDir)).toEqual([]);
  });

  it("lists modifications to tracked files", () => {
    writeFileSync(join(projectDir, "seed.txt"), "seed\nmore\n");
    expect(listMutatedTrackedFiles(projectDir)).toEqual(["seed.txt"]);
  });

  it("lists staged additions of new files", () => {
    const newPath = join(projectDir, "data", "tasks", "ready", "task-x.md");
    mkdirSync(dirname(newPath), { recursive: true });
    writeFileSync(newPath, "hello\n");
    execFileSync("git", ["add", "-A"], { cwd: projectDir });
    expect(listMutatedTrackedFiles(projectDir)).toEqual([
      "data/tasks/ready/task-x.md",
    ]);
  });

  it("does not list untracked files", () => {
    writeFileSync(join(projectDir, "scratch.txt"), "scratch\n");
    expect(listMutatedTrackedFiles(projectDir)).toEqual([]);
  });
});

describe("AgentWriteScopeViolationError", () => {
  it("formats the message with the scope and violating paths", () => {
    const err = new AgentWriteScopeViolationError({
      stepId: "sort-inbox",
      agentName: "inbox-sorter",
      scope: ["data/"],
      violations: ["src/core/foo.ts"],
    });
    expect(err.message).toContain("inbox-sorter");
    expect(err.message).toContain("data/");
    expect(err.message).toContain("src/core/foo.ts");
    expect(err.name).toBe("AgentWriteScopeViolationError");
  });

  it("labels an empty scope as <unrestricted> in the message", () => {
    const err = new AgentWriteScopeViolationError({
      stepId: "x",
      agentName: "y",
      scope: [],
      violations: ["a"],
    });
    expect(err.message).toContain("<unrestricted>");
  });
});

describe("writeWriteScopeViolationArtifact", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-write-scope-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes a typed artifact under the run directory", () => {
    const metadata = {
      id: "run-001",
      workflow: "explorer",
      runDir: ".kota/runs/run-001",
      definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
      trigger: { event: "autonomy.queue.empty", payload: {} },
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
    } as unknown as WorkflowRunMetadata;

    writeWriteScopeViolationArtifact({
      stepId: "explore",
      agentName: "explorer",
      scope: ["data/tasks/", "data/watchlist.yaml"],
      violations: ["src/core/foo.ts"],
      metadata,
      projectDir,
    });

    const artifactPath = join(
      projectDir,
      ".kota/runs/run-001/steps/explore.write-scope-violation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(parsed).toEqual({
      stepId: "explore",
      agentName: "explorer",
      scope: ["data/tasks/", "data/watchlist.yaml"],
      violations: ["src/core/foo.ts"],
    });
  });
});
