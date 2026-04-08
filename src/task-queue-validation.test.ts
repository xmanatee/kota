import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertArchitectureReadyCoverage,
  assertTaskQueueRecommendations,
  assertTaskQueueValid,
  hasArchitectureReadyCoverageGap,
  validateTaskQueue,
} from "./task-queue-validation.js";

const ROOT = process.cwd();

function writeTask(
  projectDir: string,
  state: string,
  taskId: string,
  overrides: Partial<Record<string, string>> = {},
): void {
  const dir = join(projectDir, "tasks", state);
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
  for (const state of [
    "inbox",
    "backlog",
    "ready",
    "doing",
    "blocked",
    "done",
    "dropped",
  ]) {
    mkdirSync(join(projectDir, "tasks", state), { recursive: true });
    writeFileSync(join(projectDir, "tasks", state, "AGENTS.md"), `# ${state}\n`);
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
    execSync("git add tasks && git commit -m init", {
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
    execSync("git add tasks && git commit -m init", {
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
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });
    rmSync(join(projectDir, "tasks", "ready", "task-alpha.md"));

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "task-deleted-unstaged")).toBe(true);
  });

  it("reports too many doing tasks", () => {
    writeTask(projectDir, "doing", "task-alpha", { status: "doing" });
    writeTask(projectDir, "doing", "task-beta", { status: "doing" });
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((finding) => finding.code === "too-many-doing")).toBe(true);
  });

  it("reports invalid priority values", () => {
    writeTask(projectDir, "ready", "task-alpha", { priority: "high" });
    execSync("git add tasks && git commit -m init", {
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
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.filter((f) => f.code === "task-invalid-priority")).toHaveLength(0);
  });

  it("reports tasks missing required body sections", () => {
    const dir = join(projectDir, "tasks", "ready");
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
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const sectionErrors = result.findings.filter((f) => f.code === "task-missing-required-section");
    expect(sectionErrors.length).toBe(4); // Problem, Desired Outcome, Constraints, Done When
  });

  it("reports tasks missing a subset of required body sections", () => {
    const dir = join(projectDir, "tasks", "ready");
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
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    const sectionErrors = result.findings.filter((f) => f.code === "task-missing-required-section");
    expect(sectionErrors.length).toBe(2); // Constraints and Done When missing
  });

  it("can enforce a non-empty ready queue", () => {
    writeTask(projectDir, "backlog", "task-beta");
    execSync("git add tasks && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(() => assertTaskQueueValid(projectDir, { minReady: 1 })).toThrow(
      "ready-underflow",
    );
  });

  it("can surface recommended queue depth as warnings", () => {
    writeTask(projectDir, "ready", "task-alpha");
    execSync("git add tasks && git commit -m init", {
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

  it("reports an architecture-ready coverage gap while flat built-in extensions remain", () => {
    mkdirSync(join(projectDir, "src", "extensions"), { recursive: true });
    writeFileSync(join(projectDir, "src", "extensions", "daemon.ts"), "export default {};\n");
    writeTask(projectDir, "ready", "task-ops", { area: "runtime" });
    execSync("git add tasks src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(true);
    expect(() => assertArchitectureReadyCoverage(projectDir)).toThrow(
      "tasks/ready must keep at least one architecture task",
    );
  });

  it("accepts architecture-ready coverage when a ready architecture task exists", () => {
    mkdirSync(join(projectDir, "src", "extensions"), { recursive: true });
    writeFileSync(join(projectDir, "src", "extensions", "daemon.ts"), "export default {};\n");
    writeTask(projectDir, "ready", "task-architecture", { area: "architecture" });
    execSync("git add tasks src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(false);
    expect(assertArchitectureReadyCoverage(projectDir)).toBe("architecture-ready-coverage-ok");
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
