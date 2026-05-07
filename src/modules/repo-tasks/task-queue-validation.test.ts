import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
  TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER,
  TASK_INITIATIVE_PLACEHOLDER,
  TASK_SOURCE_INTENT_PLACEHOLDER,
} from "./repo-tasks-domain.js";
import {
  assertArchitectureReadyCoverage,
  assertStrategicReadyCoverage,
  assertTaskQueueRecommendations,
  assertTaskQueueValid,
  declaresRenderedEvidence,
  hasArchitectureReadyCoverageGap,
  hasDishonestSourceAccessCompletion,
  hasNamedRenderedEvidence,
  hasStrategicReadyCoverageGap,
  listRootKernelHelperDebt,
  listRootLevelCliArchitectureDebt,
  listVisibleArchitectureDebt,
  type TaskFileEntry,
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
  const priority = overrides.priority ?? "p2";
  const openQualitySections = ["ready", "backlog", "doing", "blocked"].includes(state)
    ? `
## Source / Intent

Owner or research source asks for this because it changes a meaningful operator or architecture outcome.

${["p0", "p1", "p2"].includes(priority)
  ? `## Initiative

Strategic quality initiative that groups this task with a larger product or architecture outcome.

`
  : ""}## Acceptance Evidence

- Validation command or artifact proves the outcome.
`
    : "";
  const body = `---
id: ${taskId}
title: ${title}
status: ${overrides.status ?? state}
priority: ${priority}
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
${openQualitySections}
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

  it("requires open tasks to preserve source intent and acceptance evidence", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-weak-open.md"),
      `---
id: task-weak-open
title: Weak open task
status: ready
priority: p3
area: test
summary: Missing quality sections.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Problem.

## Desired Outcome

Outcome.

## Constraints

Constraints.

## Done When

Done.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "open-task-missing-quality-section")).toBe(true);
    expect(result.findings.some((f) => f.code === "open-task-weak-source-intent")).toBe(true);
    expect(result.findings.some((f) => f.code === "open-task-missing-acceptance-evidence")).toBe(true);
  });

  it("requires strategic open tasks to name their initiative", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-strategic-no-initiative.md"),
      `---
id: task-strategic-no-initiative
title: Strategic without initiative
status: ready
priority: p1
area: architecture
summary: Strategic task missing initiative.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Problem.

## Desired Outcome

Outcome.

## Constraints

Constraints.

## Done When

Done.

## Source / Intent

Owner or research source asks for this because it changes a meaningful operator or architecture outcome.

## Acceptance Evidence

- Validation command or artifact proves the outcome.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "strategic-task-missing-initiative")).toBe(true);
  });

  it("rejects generated fan-out consolidation tasks that count one closed task as multiple surfaces", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "blocked");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-fan-out-consolidation-answer.md"),
      `---
id: task-fan-out-consolidation-answer
title: Consolidate answer surfaces across clients
status: blocked
priority: p2
area: client
summary: Bad generated consolidation task.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Problem.

## Multi-client fan-out batch

Capability: \`answer\`

Surfaces shipped:

- macos
- mobile

Recently closed fan-out tasks in this batch:

- task-add-mobile-answerscreen (macos, closed 2026-03-28T00:00:00Z) — Add mobile AnswerScreen
- task-add-mobile-answerscreen (mobile, closed 2026-03-28T00:00:00Z) — Add mobile AnswerScreen

## Desired Outcome

Outcome with screenshots.

## Constraints

Constraints.

## Done When

- Screenshot proves the rendered state.

## Source / Intent

Owner or research source asks for this because it changes a meaningful operator or architecture outcome.

## Initiative

Strategic quality initiative that groups this task with a larger product or architecture outcome.

## Acceptance Evidence

- Screenshot under \`.kota/runs/<run-id>/\`.

## Unblock Precondition

\`\`\`
kind: operator-capture
path: .kota/runs/fan-out-screens-*
description: capture rendered surfaces
\`\`\`
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "fan-out-consolidation-duplicate-task-rows")).toBe(true);
  });

  it("warns when a blocked task ages without a fresh action marker", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "blocked");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-old-blocker.md"),
      `---
id: task-old-blocker
title: Old blocker
status: blocked
priority: p2
area: architecture
summary: Old blocked task.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Problem.

## Desired Outcome

Outcome.

## Constraints

Constraints.

## Done When

- Done.

## Source / Intent

Owner or research source asks for this because it changes a meaningful operator or architecture outcome.

## Initiative

Strategic quality initiative that groups this task with a larger product or architecture outcome.

## Acceptance Evidence

- Validation command or artifact proves the outcome.

## Unblock Precondition

\`\`\`
kind: task-done
ref: task-missing-enabler
\`\`\`
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir, { staleBlockedDays: 1 });
    expect(result.findings.some((f) => f.code === "blocked-task-stale")).toBe(true);
  });

  it("does not accept task-create scaffold placeholders as completed quality sections", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-placeholder-quality.md"),
      `---
id: task-placeholder-quality
title: Placeholder quality
status: ready
priority: p2
area: architecture
summary: Placeholder sections should not pass.
created_at: 2026-03-28T00:00:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

Problem.

## Desired Outcome

Outcome.

## Constraints

Constraints.

## Done When

Done.

## Source / Intent

${TASK_SOURCE_INTENT_PLACEHOLDER}

## Initiative

${TASK_INITIATIVE_PLACEHOLDER}

## Acceptance Evidence

${TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER}
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "open-task-weak-source-intent")).toBe(true);
    expect(result.findings.some((f) => f.code === "strategic-task-weak-initiative")).toBe(true);
    expect(result.findings.some((f) => f.code === "open-task-missing-acceptance-evidence")).toBe(true);
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

  it("does not report whitelisted cross-cutting fixtures as kernel-helper debt", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    // The fixture is on the layout whitelist (`ROOT_CROSS_CUTTING_FIXTURES`
    // in src/core/root-layout.ts), so the queue validator must agree with
    // the layout policy that this is not architecture debt.
    writeFileSync(
      join(projectDir, "src", "conversational-cross-store-fixture.integration.ts"),
      "export {};\n",
    );

    expect(listRootKernelHelperDebt(projectDir)).toEqual([]);
    expect(listVisibleArchitectureDebt(projectDir)).toEqual([]);
  });

  it("still reports an unauthorized .integration.ts fixture as kernel-helper debt", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    // Same .integration.ts extension as a whitelisted fixture, but the
    // filename is not on `ROOT_CROSS_CUTTING_FIXTURES`. The validator must
    // still surface it as debt — the whitelist is by exact name, not by
    // extension.
    writeFileSync(
      join(projectDir, "src", "phantom-helper.integration.ts"),
      "export {};\n",
    );

    expect(listRootKernelHelperDebt(projectDir)).toEqual([
      join("src", "phantom-helper.integration.ts"),
    ]);
  });

  it("accepts architecture-ready coverage when only debt is a whitelisted fixture", () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "conversational-cross-store-fixture.integration.ts"),
      "export {};\n",
    );
    writeTask(projectDir, "ready", "task-ops", { area: "runtime" });
    execSync("git add data src && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    // No ready architecture task, but the only file at src/ root is on the
    // shared whitelist — so the validator must not manufacture phantom
    // architecture debt for the autonomy queue-shaping repair loop.
    expect(hasArchitectureReadyCoverageGap(projectDir)).toBe(false);
    expect(assertArchitectureReadyCoverage(projectDir)).toBe("architecture-ready-coverage-ok");
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

function makeEntry(state: string, body: string): TaskFileEntry {
  return {
    state: state as TaskFileEntry["state"],
    fileName: "task-test.md",
    path: `data/tasks/${state}/task-test.md`,
    taskId: "task-test",
    raw: body,
  };
}

describe("hasDishonestSourceAccessCompletion", () => {
  it("flags a done task with inaccessible source and no honest handling", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview the resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nResource reviewed.\n",
      "## Notes\n\nDismissed — cannot access the URL due to auth wall.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(true);
  });

  it("ignores inaccessible language in the Problem section", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nThe source is inaccessible due to auth walls.\n",
      "## Desired Outcome\n\nHandle this better.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });

  it("accepts a done task with inaccessible source and a follow-up", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
      "## Notes\n\nSource inaccessible (HTTP 403). Created follow-up task for manual review.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });

  it("accepts a done task with inaccessible source and a blocker note", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
      "## Notes\n\nCannot review URL. Blocked on auth access being restored.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });

  it("accepts a done task with no source-access failure indicators", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nFix it.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nFixed.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });

  it("does not flag non-done tasks with inaccessible sources", () => {
    const entry = makeEntry("blocked", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
      "## Notes\n\nSource inaccessible.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });

  it("flags HTTP 402 auth-walled sources marked done without handling", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
      "## Notes\n\nHTTP 402. Dismissed — cannot review.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(true);
  });

  it("accepts source marked no longer needed", () => {
    const entry = makeEntry("done", [
      "## Problem\n\nSome problem.\n",
      "## Desired Outcome\n\nReview resource.\n",
      "## Constraints\n\nNone.\n",
      "## Done When\n\nDone.\n",
      "## Notes\n\nSource inaccessible. No longer needed since the info was covered elsewhere.\n",
    ].join("\n"));
    expect(hasDishonestSourceAccessCompletion(entry)).toBe(false);
  });
});

describe("done-task-inaccessible-source validation integration", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-source-access-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    initTaskRepo(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports done-task-inaccessible-source for a dishonest completion", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "done");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-bad-research.md"),
      `---
id: task-bad-research
title: Review auth-walled resource
status: done
priority: p2
area: research
summary: Review a URL that was not accessible.
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

Need to review a URL.

## Desired Outcome

Research completed.

## Constraints

None.

## Done When

Resource reviewed.

## Notes

Dismissed — cannot review. Source returned HTTP 402.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-task-inaccessible-source")).toBe(true);
  });

  it("does not flag a done task with honest source-access handling", () => {
    const dir = join(projectDir, REPO_TASKS_DIR, "done");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-honest-research.md"),
      `---
id: task-honest-research
title: Review auth-walled resource
status: done
priority: p2
area: research
summary: Review a URL that was not accessible.
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

Need to review a URL.

## Desired Outcome

Research completed.

## Constraints

None.

## Done When

Resource reviewed or blocker recorded.

## Notes

Source inaccessible (HTTP 402). Created follow-up task for manual access.
`,
    );
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "done-task-inaccessible-source")).toBe(false);
  });
});

describe("client-task-missing-rendered-evidence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-rendered-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    initTaskRepo(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeClientTaskBody(taskId: string, body: string): void {
    const dir = join(projectDir, REPO_TASKS_DIR, "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${taskId}.md`), body);
    execSync("git add data && git commit -m init", {
      cwd: projectDir,
      stdio: "ignore",
    });
  }

  it("flags an open client task that declares a screenshot but does not name one in evidence", () => {
    writeClientTaskBody(
      "task-screenshot-prose",
      `---
id: task-screenshot-prose
title: Show degraded provider state in macOS popover
status: ready
priority: p2
area: client
summary: Render degraded provider state distinctly in the macOS menu bar.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

Operators cannot see when a provider is degraded.

## Desired Outcome

Operators see degraded provider state directly in the popover.

## Constraints

Keep the macOS app thin.

## Done When

- Degraded provider state renders in the popover with a clear visual indicator.
- A screenshot proves the rendered degraded state.

## Source / Intent

Owner asked for it.

## Initiative

Operator UX consolidation.

## Acceptance Evidence

- Swift build/test output covers the view-model branch.
- Branch description in the run notes covers the visual change.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(true);
  });

  it("accepts an open client task that names a screenshot in evidence", () => {
    writeClientTaskBody(
      "task-screenshot-named",
      `---
id: task-screenshot-named
title: Show degraded provider state in macOS popover
status: ready
priority: p2
area: client
summary: Render degraded provider state distinctly in the macOS menu bar.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

Operators cannot see when a provider is degraded.

## Desired Outcome

Operators see degraded provider state directly in the popover.

## Constraints

Keep the macOS app thin.

## Done When

- Degraded provider state renders in the popover with a clear visual indicator.
- A screenshot proves the rendered degraded state.

## Source / Intent

Owner asked for it.

## Initiative

Operator UX consolidation.

## Acceptance Evidence

- Swift build/test output covering the view-model branch.
- Screenshot under \`.kota/runs/<run-id>/\` showing the degraded provider state.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(false);
  });

  it("accepts a CLI/channel task that names a transcript", () => {
    writeClientTaskBody(
      "task-cli-transcript",
      `---
id: task-cli-transcript
title: Show daemon identity in kota status
status: ready
priority: p2
area: client
summary: Make CLI status report connection identity.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

CLI status hides the daemon URL.

## Desired Outcome

\`kota status\` prints the connected project, control file, and base URL.

## Constraints

Do not leak tokens.

## Done When

- \`kota status\` prints a transcript showing project identity and base URL.
- Tokens redacted.

## Source / Intent

Operator request.

## Initiative

Daemon identity clarity.

## Acceptance Evidence

- Tests for the new status formatter.
- Transcript of \`kota status\` against a wrong-project control file.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(false);
  });

  it("accepts a runtime-probe declaration", () => {
    writeClientTaskBody(
      "task-runtime-probe",
      `---
id: task-runtime-probe
title: Surface dashboard URL in /api/dashboard
status: ready
priority: p2
area: client
summary: Expose dashboard availability via daemon route.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

Dashboard URL is implicit.

## Desired Outcome

Daemon exposes dashboard availability through a typed runtime probe.

## Constraints

None.

## Done When

- Daemon exposes the URL.
- Runtime probe verifies the URL and availability state.

## Source / Intent

Operator request.

## Initiative

Daemon identity clarity.

## Acceptance Evidence

- Tests cover decoder.
- Runtime probe \`curl -fsS $DAEMON_URL/api/dashboard\` returns the typed shape.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(false);
  });

  it("does not fire on area=autonomy tasks that discuss rendered evidence as a meta-policy", () => {
    writeClientTaskBody(
      "task-fanout-meta",
      `---
id: task-fanout-meta
title: Add fan-out consolidation reviews
status: ready
priority: p2
area: autonomy
summary: Detect multi-client fan-out batches and seed a consolidation review.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

Fan-out cadence ships parity but no IA consolidation.

## Desired Outcome

Queue-shaping seeds a consolidation task that checks IA, runtime contract, screenshots, and transcripts.

## Constraints

Avoid endless review tasks.

## Done When

- Detector identifies fan-out batches and seeds a consolidation task.
- Tests prove the detector behavior.

## Source / Intent

Owner request.

## Initiative

Autonomy quality control.

## Acceptance Evidence

- Workflow/unit test output for the detector.
- Example generated consolidation task from a fixture sequence.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(false);
  });

  it("does not fire on internal refactors that mention rendered artifacts only as coordination notes", () => {
    writeClientTaskBody(
      "task-refactor-state",
      `---
id: task-refactor-state
title: Make AppState injectable in tests
status: ready
priority: p2
area: client
summary: Refactor macOS AppState to inject side effects.
created_at: 2026-04-28T00:00:00Z
updated_at: 2026-04-28T00:00:00Z
---

## Problem

AppState calls notification APIs in init.

## Desired Outcome

AppState can be constructed without OS bundle requirements.

## Constraints

- Coordinate with visual/runtime evidence tasks so new tests support rendered artifacts where possible.

## Done When

- AppState can be constructed without notification authorization.
- Existing Swift tests remain green.

## Source / Intent

Run evidence found AppState was hard to test.

## Initiative

Native-client testability.

## Acceptance Evidence

- Swift test output exercising AppState constructed in unit tests.
- A short audit note for mobile/native side-effect initialization.
`,
    );

    const result = validateTaskQueue(projectDir);
    expect(result.findings.some((f) => f.code === "client-task-missing-rendered-evidence")).toBe(false);
  });
});

describe("declaresRenderedEvidence / hasNamedRenderedEvidence", () => {
  it("declares evidence on Done When mention of screenshot", () => {
    expect(declaresRenderedEvidence([
      "## Desired Outcome\n\nOperators see degraded state.\n",
      "## Done When\n\n- A screenshot proves the rendered state.\n",
      "## Acceptance Evidence\n\n- Tests pass.\n",
    ].join("\n"))).toBe(true);
  });

  it("ignores evidence-keyword mention only inside Acceptance Evidence", () => {
    expect(declaresRenderedEvidence([
      "## Desired Outcome\n\nMake the type stricter.\n",
      "## Done When\n\n- Strict type lands.\n",
      "## Acceptance Evidence\n\n- Screenshot of typecheck.\n",
    ].join("\n"))).toBe(false);
  });

  it("recognizes a named transcript in Acceptance Evidence", () => {
    expect(hasNamedRenderedEvidence([
      "## Acceptance Evidence\n\n- Transcript of `kota status`.\n",
    ].join("\n"))).toBe(true);
  });

  it("rejects evidence sections that only name tests", () => {
    expect(hasNamedRenderedEvidence([
      "## Acceptance Evidence\n\n- Unit tests for the new branch.\n",
    ].join("\n"))).toBe(false);
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
