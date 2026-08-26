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
  diffMutatedPaths,
  findWorkflowScratchArtifactPaths,
  findWriteScopeViolations,
  listWorkflowMutatedPaths,
  pathInScope,
  removeWorkflowScratchArtifacts,
  requiresWriteScopeSnapshot,
  tryListWorkflowMutatedPaths,
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

describe("requiresWriteScopeSnapshot", () => {
  it("captures full snapshots only for enforceable scopes", () => {
    expect(requiresWriteScopeSnapshot([])).toBe(false);
    expect(requiresWriteScopeSnapshot(["src/"])).toBe(true);
    expect(requiresWriteScopeSnapshot("deny-all")).toBe(true);
  });
});

describe("listWorkflowMutatedPaths", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-write-scope-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: scopeRoot,
    });
    writeFileSync(join(scopeRoot, "seed.txt"), "seed\n");
    writeFileSync(join(scopeRoot, ".gitignore"), "ignored.txt\n");
    execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("returns [] when the tree is clean", () => {
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual([]);
  });

  it("lists modifications to tracked files", () => {
    writeFileSync(join(scopeRoot, "seed.txt"), "seed\nmore\n");
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual(["seed.txt"]);
  });

  it("lists staged additions of new files", () => {
    const newPath = join(scopeRoot, "data", "tasks", "ready", "task-x.md");
    mkdirSync(dirname(newPath), { recursive: true });
    writeFileSync(newPath, "hello\n");
    execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual([
      "data/tasks/ready/task-x.md",
    ]);
  });

  it("lists untracked files that `git add -A` would stage", () => {
    writeFileSync(join(scopeRoot, "scratch.txt"), "scratch\n");
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual(["scratch.txt"]);
  });

  it("lists untracked files in new subdirectories", () => {
    const nested = join(scopeRoot, "src", "core", "new.ts");
    mkdirSync(dirname(nested), { recursive: true });
    writeFileSync(nested, "export {};\n");
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual(["src/core/new.ts"]);
  });

  it("excludes gitignored untracked files", () => {
    writeFileSync(join(scopeRoot, "ignored.txt"), "shh\n");
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual([]);
  });

  it("merges tracked mutations, staged additions, and untracked files", () => {
    writeFileSync(join(scopeRoot, "seed.txt"), "seed\nmore\n");
    const staged = join(scopeRoot, "data", "tasks", "ready", "task-x.md");
    mkdirSync(dirname(staged), { recursive: true });
    writeFileSync(staged, "hello\n");
    execFileSync("git", ["add", "data/tasks/ready/task-x.md"], {
      cwd: scopeRoot,
    });
    writeFileSync(join(scopeRoot, "scratch.txt"), "scratch\n");
    expect(listWorkflowMutatedPaths(scopeRoot)).toEqual([
      "data/tasks/ready/task-x.md",
      "scratch.txt",
      "seed.txt",
    ]);
  });

  it("lists staged and untracked paths in an unborn git repository", () => {
    const unbornDir = join(
      tmpdir(),
      `kota-write-scope-unborn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      mkdirSync(unbornDir, { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: unbornDir });
      writeFileSync(join(unbornDir, "staged.txt"), "staged\n");
      execFileSync("git", ["add", "staged.txt"], { cwd: unbornDir });
      writeFileSync(join(unbornDir, "untracked.txt"), "untracked\n");

      expect(listWorkflowMutatedPaths(unbornDir)).toEqual([
        "staged.txt",
        "untracked.txt",
      ]);
      expect(tryListWorkflowMutatedPaths(unbornDir)).toEqual([
        "staged.txt",
        "untracked.txt",
      ]);
    } finally {
      rmSync(unbornDir, { recursive: true, force: true });
    }
  });
});

describe("diffMutatedPaths", () => {
  it("returns [] when pre and post match exactly", () => {
    expect(
      diffMutatedPaths(
        ["data/tasks/ready/a.md", "scratch.txt"],
        ["data/tasks/ready/a.md", "scratch.txt"],
      ),
    ).toEqual([]);
  });

  it("attributes only paths newly mutated during the step", () => {
    expect(
      diffMutatedPaths(
        ["src/modules/autonomy/AGENTS.md"],
        [
          "src/modules/autonomy/AGENTS.md",
          "data/tasks/ready/new-task.md",
        ],
      ),
    ).toEqual(["data/tasks/ready/new-task.md"]);
  });

  it("excludes prior-step or concurrent mutations from this step's attribution", () => {
    // Pre-existing tracked modification that this step did not touch. A
    // concurrent workflow's agent step can produce the same shape by writing
    // between this step's pre-snapshot and post-snapshot.
    expect(
      diffMutatedPaths(
        [],
        ["src/modules/autonomy/AGENTS.md"],
      ),
    ).toEqual(["src/modules/autonomy/AGENTS.md"]);

    // Same file, but recorded as already mutated before this step started →
    // attributes it to a prior/concurrent step, not this one.
    expect(
      diffMutatedPaths(
        ["src/modules/autonomy/AGENTS.md"],
        ["src/modules/autonomy/AGENTS.md"],
      ),
    ).toEqual([]);
  });

  it("sorts the attributed paths", () => {
    expect(
      diffMutatedPaths(
        [],
        ["zebra.txt", "apple.txt", "mango.txt"],
      ),
    ).toEqual(["apple.txt", "mango.txt", "zebra.txt"]);
  });
});

describe("writeScope enforcement over mutated paths", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-write-scope-enforce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: scopeRoot,
    });
    writeFileSync(join(scopeRoot, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("flags an untracked file written outside the declared writeScope", () => {
    writeFileSync(join(scopeRoot, "stowaway.ts"), "export {};\n");
    const violations = findWriteScopeViolations(
      listWorkflowMutatedPaths(scopeRoot),
      ["data/tasks/"],
    );
    expect(violations).toEqual(["stowaway.ts"]);
  });

  it("accepts an untracked file inside the declared writeScope", () => {
    const inScope = join(scopeRoot, "data", "tasks", "ready", "new.md");
    mkdirSync(dirname(inScope), { recursive: true });
    writeFileSync(inScope, "hello\n");
    const violations = findWriteScopeViolations(
      listWorkflowMutatedPaths(scopeRoot),
      ["data/tasks/"],
    );
    expect(violations).toEqual([]);
  });
});

describe("workflow scratch artifact handling", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-write-scope-scratch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: scopeRoot,
    });
    writeFileSync(join(scopeRoot, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("identifies native harness scratch artifacts by exact path and directory", () => {
    expect(
      findWorkflowScratchArtifactPaths([
        ".playwright-mcp/console.log",
        ".playwright-mcp/page.yml",
        "x-article-body.txt",
        ".playwright-mcp-old/console.log",
        "src/x-article-body.txt",
      ]),
    ).toEqual([
      ".playwright-mcp/console.log",
      ".playwright-mcp/page.yml",
      "x-article-body.txt",
    ]);
  });

  it("removes untracked native harness scratch artifacts", () => {
    mkdirSync(join(scopeRoot, ".playwright-mcp"), { recursive: true });
    writeFileSync(join(scopeRoot, ".playwright-mcp", "console.log"), "tmp\n");
    writeFileSync(join(scopeRoot, "x-article-body.txt"), "tmp\n");

    expect(removeWorkflowScratchArtifacts(scopeRoot)).toEqual([
      ".playwright-mcp",
      "x-article-body.txt",
    ]);
    expect(existsSync(join(scopeRoot, ".playwright-mcp"))).toBe(false);
    expect(existsSync(join(scopeRoot, "x-article-body.txt"))).toBe(false);
  });

  it("does not remove tracked files that match scratch artifact names", () => {
    mkdirSync(join(scopeRoot, ".playwright-mcp"), { recursive: true });
    writeFileSync(join(scopeRoot, ".playwright-mcp", "fixture.yml"), "tracked\n");
    writeFileSync(join(scopeRoot, "x-article-body.txt"), "tracked\n");
    execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "track scratch-shaped files"], {
      cwd: scopeRoot,
    });

    expect(removeWorkflowScratchArtifacts(scopeRoot)).toEqual([]);
    expect(existsSync(join(scopeRoot, ".playwright-mcp", "fixture.yml"))).toBe(true);
    expect(existsSync(join(scopeRoot, "x-article-body.txt"))).toBe(true);
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
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-write-scope-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
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
      scopeRoot,
    });

    const artifactPath = join(
      scopeRoot,
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
