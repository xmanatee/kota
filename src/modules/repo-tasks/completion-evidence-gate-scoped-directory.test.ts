import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
} from "./repo-tasks-domain.js";
import { validateTaskQueue } from "./task-queue-validation.js";

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

function writeTaskBody(projectDir: string, state: string, taskId: string, body: string): void {
  const stateDir = join(projectDir, REPO_TASKS_DIR, state);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, `${taskId}.md`), body);
  execSync("git add data && git commit -m init", {
    cwd: projectDir,
    stdio: "ignore",
  });
}

function fullCliTask(taskId: string, acceptanceEvidence: string): string {
  return `---
id: ${taskId}
title: Replace bare kota with the full daemon-backed CLI client
status: done
priority: p1
area: client
summary: Replace the shallow terminal navigator with a full operator CLI over shared daemon surfaces.
created_at: 2026-07-08T00:00:00Z
updated_at: 2026-07-08T00:00:00Z
task_class: Product
---

## Problem

The default CLI is still a shallow numbered navigator.

## Desired Outcome

Bare \`kota\` opens a full daemon-backed CLI/TUI client with scopes, workflows,
modules, setup, approvals, owner requests, model controls, and live runs.

## Constraints

Evidence must be the real operator journey, not only unit tests.

## Done When

- Bare \`kota\` starts the full CLI client in a TTY.
- Keyboard navigation, action execution, and live run supervision are covered.

## Source / Intent

Owner asked for the default CLI to become the real operator client.

## Initiative

CLI as first-class KOTA client.

## Acceptance Evidence

${acceptanceEvidence}
`;
}

describe("operator client completion evidence scoped directories", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-completion-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    initTaskRepo(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("accepts a new done full-CLI Product task with a task-scoped run evidence directory", () => {
    const taskId = "task-evidenced-full-cli";
    const evidenceDir = `.kota/runs/2026-07-08T00-00-00-000Z-builder-test/evidence/${taskId}/`;
    writeTaskBody(
      projectDir,
      "done",
      taskId,
      fullCliTask(
        taskId,
        [
          `- Full CLI transcript under \`${evidenceDir}\` showing`,
          "  scopes, workflows, modules, setup, approvals, owner requests, model controls,",
          "  and live run supervision.",
        ].join("\n"),
      ),
    );
    mkdirSync(join(projectDir, evidenceDir), { recursive: true });
    writeFileSync(join(projectDir, evidenceDir, "transcript.txt"), "kota\nscopes\nworkflows\nmodules\n");

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-operator-client-missing-rendered-evidence")).toBe(false);
  });

  it("rejects broad directory evidence references with unrelated proof descendants", () => {
    for (const path of [
      join(projectDir, ".kota", "runs", "some-other-run", "transcript.txt"),
      join(projectDir, "transcript.txt"),
      join(projectDir, "artifacts", "old-run", "transcript.txt"),
    ]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "unrelated transcript\n");
    }
    for (const [taskId, evidence] of [
      ["task-broad-runs-evidence", "- Full CLI transcript under `.kota/runs/`."],
      ["task-project-root-evidence", "- Full CLI transcript under `./`."],
      ["task-generic-artifacts-evidence", "- Full CLI transcript under `artifacts/`."],
    ] as const) {
      writeTaskBody(projectDir, "done", taskId, fullCliTask(taskId, evidence));
    }

    const result = validateTaskQueue(projectDir);
    const renderedEvidenceFailures = result.findings.filter(
      (finding) => finding.code === "done-operator-client-missing-rendered-evidence",
    );

    expect(renderedEvidenceFailures.map((finding) => basename(finding.paths?.[0] ?? "")).sort()).toEqual([
      "task-broad-runs-evidence.md",
      "task-generic-artifacts-evidence.md",
      "task-project-root-evidence.md",
    ]);
  });

  it("rejects a run evidence directory that is not tied to the task", () => {
    const taskId = "task-unscoped-run-evidence";
    writeTaskBody(
      projectDir,
      "done",
      taskId,
      fullCliTask(
        taskId,
        "- Full CLI transcript under `.kota/runs/2026-07-08T00-00-00-000Z-builder-test/`.",
      ),
    );
    mkdirSync(join(projectDir, ".kota", "runs", "2026-07-08T00-00-00-000Z-builder-test"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "runs", "2026-07-08T00-00-00-000Z-builder-test", "transcript.txt"),
      "unrelated transcript\n",
    );

    const result = validateTaskQueue(projectDir);
    const renderedEvidenceFailures = result.findings.filter(
      (finding) => finding.code === "done-operator-client-missing-rendered-evidence",
    );

    expect(renderedEvidenceFailures.map((finding) => basename(finding.paths?.[0] ?? ""))).toEqual([
      "task-unscoped-run-evidence.md",
    ]);
  });
});
