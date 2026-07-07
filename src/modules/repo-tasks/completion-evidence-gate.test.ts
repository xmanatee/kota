import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
} from "./repo-tasks-domain.js";
import {
  hasNamedRenderedEvidence,
  validateTaskQueue,
} from "./task-queue-validation.js";

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

describe("operator client completion evidence gate", () => {
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

  it("flags a new done full-CLI Product task without rendered/runtime evidence", () => {
    writeTaskBody(
      projectDir,
      "done",
      "task-overclaimed-full-cli",
      fullCliTask(
        "task-overclaimed-full-cli",
        "- Unit and integration tests for CLI routing and action execution.",
      ),
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-operator-client-missing-rendered-evidence")).toBe(true);
  });

  it("accepts a new done full-CLI Product task with transcript evidence", () => {
    writeTaskBody(
      projectDir,
      "done",
      "task-evidenced-full-cli",
      fullCliTask(
        "task-evidenced-full-cli",
        [
          "- Full CLI transcript under `.kota/runs/<run-id>/transcript.txt` showing",
          "  scopes, workflows, modules, setup, approvals, owner requests, model controls,",
          "  and live run supervision.",
          "- Unit and integration tests for CLI routing and action execution.",
        ].join("\n"),
      ),
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-operator-client-missing-rendered-evidence")).toBe(false);
  });

  it("does not flag new done internal client refactors with ordinary test evidence", () => {
    writeTaskBody(
      projectDir,
      "done",
      "task-internal-client-refactor",
      `---
id: task-internal-client-refactor
title: Make AppState injectable in tests
status: done
priority: p2
area: client
summary: Refactor macOS AppState to inject side effects.
created_at: 2026-07-08T00:00:00Z
updated_at: 2026-07-08T00:00:00Z
---

## Problem

AppState calls notification APIs in init.

## Desired Outcome

AppState can be constructed without OS bundle requirements.

## Constraints

Keep the app thin.

## Done When

- AppState can be constructed without notification authorization.
- Existing Swift tests remain green.

## Source / Intent

Run evidence found AppState was hard to test.

## Initiative

Native-client testability.

## Acceptance Evidence

- Swift test output exercising AppState constructed in unit tests.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-operator-client-missing-rendered-evidence")).toBe(false);
  });

  it("recognizes dashboard/status transcripts, traces, native snapshots, and daemon route probes", () => {
    const acceptedEvidence = [
      "Dashboard status transcript under `.kota/runs/<run-id>/transcript.txt`.",
      "Playwright trace and HTML report for the web dashboard.",
      "Native snapshot fixture for the macOS popover.",
      "Daemon route runtime probe for `/api/tasks`.",
    ];

    for (const evidence of acceptedEvidence) {
      expect(hasNamedRenderedEvidence(`## Acceptance Evidence\n\n- ${evidence}\n`)).toBe(true);
    }
  });
});
