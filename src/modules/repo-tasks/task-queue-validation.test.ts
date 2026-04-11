import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_INBOX_DIR, REPO_TASK_STATES, REPO_TASKS_DIR } from "#core/data/repo-tasks.js";
import {
  assertArchitectureReadyCoverage,
  assertStrategicReadyCoverage,
  assertTaskQueueRecommendations,
  assertTaskQueueValid,
  hasArchitectureReadyCoverageGap,
  hasStrategicReadyCoverageGap,
  listRootKernelHelperDebt,
  listRootLevelCliArchitectureDebt,
  validateTaskQueue,
} from "./task-queue-validation.js";

const ROOT = process.cwd();

function writeTask(
  projectDir: string,
  state: string,
  taskId: string,
  overrides: Partial<Record<string, string>> = {},
): void {
  const dir = join(projectDir, REPO_TASKS_DIR, state);
  mkdirSync(dir, { recursive: true });
  const title = overrides.title ?? taskId;
  const body = `---
id: ${taskId}
title: ${title}
status: ${overrides.status ?? state}
priority: ${overrides.priority ?? "p2"}
area: ${overrides.area ?? "workflow"}
summary: ${overrides.summary ?? "Summary."}
created_at: ${overrides.created_at ?? "2026-03-28T00:00:00Z"}
updated_at: ${overrides.updated_at ?? "2026-03-28T00:00:00Z"}
---

## Problem

Problem.

## Desired Outcome

Outcome.

## Constraints

Constraints.

## Done When

Done.
`;
  writeFileSync(join(dir, `${taskId}.md`), body);
}

function initTaskRepo(projectDir: string): void {
  mkdirSync(join(projectDir, REPO_INBOX_DIR), { recursive: true });
  writeFileSync(join(projectDir, REPO_INBOX_DIR, "AGENTS.md"), "# inbox\n");
  for (const state of REPO_TASK_STATES) {
    mkdirSync(join(projectDir, REPO_TASKS_DIR, state), { recursive: true });
    writeFileSync(join(projectDir, REPO_TASKS_DIR, state, "AGENTS.md"), `# ${state}\n`);
  }
  execSync("git init", { cwd: projectDir, stdio: "ignore" });
  execSync('git config user.email "test@test"', { cwd: projectDir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: projectDir, stdio: "ignore" });
}

describe("task queue validation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-task-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    initTaskRepo(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("accepts a clean tracked queue", () => {
    writeTask(projectDir, "ready", "task-alpha");
    writeTask(projectDir, "backlog", "task-beta");
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.counts.ready).toBe(1);
    expect(result.counts.backlog).toBe(1);
  });

  it("reports duplicate task ids across states", () => {
    writeTask(projectDir, "ready", "task-alpha");
    writeTask(projectDir, "doing", "task-alpha", { status: "doing" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "task-duplicate-state")).toBe(true);
  });

  it("reports untracked task files", () => {
    writeTask(projectDir, "ready", "task-alpha");
    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "task-untracked")).toBe(true);
  });

  it("reports deleted tracked task files", () => {
    writeTask(projectDir, "ready", "task-alpha");
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });
    rmSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-alpha.md"));

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "task-deleted-unstaged")).toBe(true);
  });

  it("reports too many doing tasks", () => {
    writeTask(projectDir, "doing", "task-alpha", { status: "doing" });
    writeTask(projectDir, "doing", "task-beta", { status: "doing" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "too-many-doing")).toBe(true);
  });

  it("reports invalid priority values", () => {
    writeTask(projectDir, "ready", "task-alpha", { priority: "high" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "task-invalid-priority")).toBe(true);
  });

  it("accepts valid priority values p0–p3", () => {
    writeTask(projectDir, "ready", "task-p0", { priority: "p0" });
    writeTask(projectDir, "ready", "task-p1", { priority: "p1" });
    writeTask(projectDir, "backlog", "task-p2", { priority: "p2" });
    writeTask(projectDir, "backlog", "task-p3", { priority: "p3" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.filter((f) => f.code === "task-invalid-priority")).toHaveLength(0);
  });

  it("reports tasks missing required body sections", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-no-sections.md"),
      `---
id: task-no-sections
title: No sections
status: ready
priority: p2
area: test
summary: Missing sections.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

Just some text with no required sections.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const sectionErrors = result.findings.filter((f) => f.code === "task-missing-required-section");
    expect(sectionErrors.length).toBe(4); // Problem, Desired Outcome, Constraints, Done When
  });

  it("reports tasks missing a subset of required body sections", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-partial.md"),
      `---
id: task-partial
title: Partial sections
status: ready
priority: p2
area: test
summary: Partial sections.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Has a problem.

## Desired Outcome

Has an outcome.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const sectionErrors = result.findings.filter((f) => f.code === "task-missing-required-section");
    expect(sectionErrors.length).toBe(2); // Constraints and Done When missing
  });

  it("can enforce a non-empty ready queue", () => {
    writeTask(projectDir, "backlog", "task-beta");
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(() => assertTaskQueueValid(projectDir, { minReady: 1 })).toThrow(
      "ready-underflow",
    );
  });

  it("can surface recommended queue depth as warnings", () => {
    writeTask(projectDir, "ready", "task-alpha");
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(() =>
      assertTaskQueueRecommendations(projectDir, {
        recommendedMinReady: 2,
        recommendedMinBacklog: 1,
      }),
    ).toThrow("ready-thin");
  });

  it("detects when the actionable queue has drifted to p3-only work", () => {
    writeTask(projectDir, "ready", "task-alpha", { priority: "p3" });
    writeTask(projectDir, "backlog", "task-beta", { priority: "p3" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasStrategicReadyCoverageGap(projectDir)).toBe(true);
    expect(() => assertStrategicReadyCoverage(projectDir)).toThrow(
      "data/tasks/ready must keep at least one p0/p1/p2 task",
    );
  });

  it("accepts a ready queue with a substantive p2 task", () => {
    writeTask(projectDir, "ready", "task-alpha", { priority: "p2" });
    writeTask(projectDir, "backlog", "task-beta", { priority: "p3" });
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasStrategicReadyCoverageGap(projectDir)).toBe(false);
  });

  it("reports an architecture-ready coverage gap while root-level project module files remain", () => {
    mkdirSync(join(projectDir, "src", "modules"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "daemon.ts"), "export default {};\n");
    writeTask(projectDir, "ready", "task-ops", { area: "runtime" });
    execSync("git add data src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(true);
    expect(() => assertArchitectureReadyCoverage(projectDir)).toThrow(
      "data/tasks/ready must keep at least one p1/p2 architecture task",
    );
  });

  it("accepts architecture-ready coverage when a ready p2 architecture task exists", () => {
    mkdirSync(join(projectDir, "src", "modules"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "daemon.ts"), "export default {};\n");
    writeTask(projectDir, "ready", "task-architecture", { area: "architecture", priority: "p2" });
    execSync("git add data src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(false);
    expect(assertArchitectureReadyCoverage(projectDir)).toBe("architecture-ready-coverage-ok");
  });

  it("treats p3 architecture work as insufficient while visible architecture debt remains", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "cli.ts"),
      'import { registerCompletionCommands } from "./completion-cli.js";\n',
    );
    writeTask(projectDir, "ready", "task-architecture", { area: "architecture", priority: "p3" });
    execSync("git add data src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(true);
  });

  it("detects loose kernel helpers in src/ root beyond known entrypoints", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "cli.ts"), "// entrypoint\n");
    writeFileSync(join(projectDir, "src", "init.ts"), "// entrypoint\n");
    writeFileSync(join(projectDir, "src", "config.ts"), "// kernel helper\n");
    writeFileSync(join(projectDir, "src", "frontmatter.ts"), "// kernel helper\n");
    writeFileSync(join(projectDir, "src", "config.test.ts"), "// test file\n");

    const debt = listRootKernelHelperDebt(projectDir);
    expect(debt).toEqual([
      join("src", "config.ts"),
      join("src", "frontmatter.ts"),
    ]);
  });

  it("reports architecture coverage gap when loose root kernel helpers exist", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "config.ts"), "// kernel helper\n");
    writeTask(projectDir, "ready", "task-ops", { area: "runtime" });
    execSync("git add data src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(true);
  });

  it("detects root-level CLI extraction debt from src/cli.ts", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "cli.ts"),
      [
        'import { registerHistoryCommands } from "./modules/history/cli.js";',
        'import { registerCompletionCommands } from "./completion-cli.js";',
        'import { registerWebhookCommands } from "./webhook-cli.js";',
        'import { registerInitCommand } from "./init-cli.js";',
      ].join("\n"),
    );

    expect(listRootLevelCliArchitectureDebt(projectDir)).toEqual([
      join("src", "completion-cli.ts"),
      join("src", "init-cli.ts"),
      join("src", "webhook-cli.ts"),
    ]);
  });

  it("rejects npm package-manager commands in active guidance and open tasks", () => {
    mkdirSync(join(projectDir, "docs"), { recursive: true });
    writeFileSync(join(projectDir, "AGENTS.md"), "# Root\n\nUse pnpm.\n");
    writeFileSync(join(projectDir, "docs", "STANDARDS.md"), "Use npm test.\n");
    writeTask(projectDir, "ready", "task-alpha", { summary: "Run npm test." });
    writeTask(projectDir, "done", "task-archived", { status: "done", summary: "Old npm test note." });
    execSync("git add data docs AGENTS.md && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const finding = result.findings.find((f) => f.code === "active-guidance-uses-npm");

    expect(finding?.paths).toContain("docs/STANDARDS.md");
    expect(finding?.paths).toContain(join("data", "tasks", "ready", "task-alpha.md"));
    expect(finding?.paths).not.toContain(join("data", "tasks", "done", "task-archived.md"));
  });

  it("rejects active guidance that optimizes for small diffs over clean outcomes", () => {
    mkdirSync(join(projectDir, "docs"), { recursive: true });
    writeFileSync(join(projectDir, "AGENTS.md"), "# Root\n\nUse pnpm.\n");
    writeFileSync(join(projectDir, "docs", "STANDARDS.md"), "Prefer the smallest patch.\n");
    writeTask(projectDir, "ready", "task-alpha", { summary: "Make a surgical fix." });
    writeTask(projectDir, "done", "task-archived", { status: "done", summary: "Old minimal diff note." });
    execSync("git add data docs AGENTS.md && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const finding = result.findings.find((f) => f.code === "active-guidance-optimizes-small-diffs");

    expect(finding?.paths).toContain("docs/STANDARDS.md");
    expect(finding?.paths).toContain(join("data", "tasks", "ready", "task-alpha.md"));
    expect(finding?.paths).not.toContain(join("data", "tasks", "done", "task-archived.md"));
  });
});

describe("current repo task queue", () => {
  it("is structurally consistent and tracked", () => {
    const result = validateTaskQueue(ROOT);
    expect(result.errorCount).toBe(0);
  });

  it("has at most one doing task", () => {
    const result = validateTaskQueue(ROOT);
    expect(result.counts.doing).toBeLessThanOrEqual(1);
  });
});
