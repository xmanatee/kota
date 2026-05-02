/**
 * Queue-health policy fixture for the empty-queue loop. Proves that an empty
 * `ready/` with backlog present is treated as a queue-health condition that
 * requires deliberate selection — not as an automatic invitation for builder
 * to consume backlog in arbitrary order.
 *
 * Covers two halves of the policy documented in
 * `src/modules/autonomy/AGENTS.md` (`Empty-Queue Loop Shape`):
 *   1. The dispatcher distinguishes actionable (ready+doing>0) from
 *      backlog-only state by event name. Builder gates on
 *      `autonomy.queue.available` and never sees `autonomy.queue.needs-
 *      promotion`, so it cannot drain backlog without an upstream selection.
 *   2. The backlog-promoter — the workflow that consumes
 *      `needs-promotion` — writes a recorded rationale comparing the
 *      promoted task against rejected blocked alternatives before any
 *      builder step runs.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import backlogPromoterWorkflow from "./backlog-promoter/workflow.js";
import dispatcherWorkflow from "./dispatcher/workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  })),
  getRepoHeadSha: vi.fn(() => "abc1234"),
}));

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
    "#modules/autonomy/commit.js",
  );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
    "#modules/autonomy/shared.js",
  );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

const TASK_TEMPLATE = (
  state: "backlog" | "blocked",
  id: string,
  options: {
    priority?: string;
    area?: string;
    title?: string;
    summary?: string;
    body?: string;
  } = {},
): string => {
  const priority = options.priority ?? "p2";
  const area = options.area ?? "modules";
  const title = options.title ?? id;
  const summary = options.summary ?? `${id} summary`;
  const updatedAt = "2026-04-01T00:00:00.000Z";
  const extra = options.body ?? "";
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${state}`,
    `priority: ${priority}`,
    `area: ${area}`,
    `summary: ${summary}`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    "---",
    "",
    "## Problem",
    "Body.",
    "",
    "## Desired Outcome",
    "Outcome.",
    "",
    "## Constraints",
    "Constraints.",
    "",
    "## Done When",
    "- when",
    "",
    "## Source / Intent",
    "Owner asked for this.",
    "",
    "## Initiative",
    "Strategic initiative grouping.",
    "",
    "## Acceptance Evidence",
    "- Tests.",
    "",
    extra,
    "",
  ].join("\n");
};

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "queue-health-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function commitInitial(dir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], { cwd: dir });
}

describe("empty-queue policy: ready/ empty, backlog present", () => {
  it("dispatcher emits needs-promotion (not queue.available) so builder cannot run", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-strategic.md"),
      TASK_TEMPLATE("backlog", "task-strategic", {
        priority: "p1",
        area: "architecture",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-narrow-fanout.md"),
      TASK_TEMPLATE("backlog", "task-narrow-fanout", {
        priority: "p2",
        area: "client",
        title: "Wire up dashboard sidebar",
      }),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const events = result.emitted.map((e) => e.event);
    expect(events).toContain("autonomy.queue.needs-promotion");
    expect(events).not.toContain("autonomy.queue.available");
  });

  it("backlog-promoter records a rationale identifying chosen task and rejected alternatives before builder can resume", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-strategic.md"),
      TASK_TEMPLATE("backlog", "task-strategic", {
        priority: "p1",
        area: "architecture",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-narrow-fanout.md"),
      TASK_TEMPLATE("backlog", "task-narrow-fanout", {
        priority: "p2",
        area: "client",
        title: "Wire up dashboard sidebar",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-blocked-arch.md"),
      TASK_TEMPLATE("blocked", "task-blocked-arch", {
        priority: "p1",
        area: "architecture",
        body: "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve?\n",
      }),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const writeRationale = result.steps["write-rationale"].output as {
      written: boolean;
      artifactPath: string;
    };
    expect(writeRationale.written).toBe(true);

    const rationale = JSON.parse(readFileSync(writeRationale.artifactPath, "utf-8")) as {
      selected: Array<{ id: string; reason: string }>;
      rejected: Array<{ id: string; state: string; reason: string }>;
      summary: string;
    };
    // The strategic backlog task wins on (p1, strategic area, age) over the
    // p2 client fan-out task.
    expect(rationale.selected.map((s) => s.id)).toContain("task-strategic");
    // The blocked alternative is recorded as rejected with a precondition reason.
    const blockedRejection = rationale.rejected.find((r) => r.id === "task-blocked-arch");
    expect(blockedRejection).toBeDefined();
    expect(blockedRejection?.state).toBe("blocked");
    expect(blockedRejection?.reason).toMatch(/precondition/);
    expect(rationale.summary).toMatch(/Promoted/);
  });

  it("backlog-promoter writes no rationale and emits no promotion event when only blocked work remains", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-blocked-only.md"),
      TASK_TEMPLATE("blocked", "task-blocked-only", {
        priority: "p1",
        area: "architecture",
        body: "## Unblock Precondition\n\nkind: owner-decision\nslot: only\nquestion: Approve?\n",
      }),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    // Without backlog candidates, the promoter explicitly opts not to act.
    expect(result.steps["write-rationale"].status).toBe("skipped");
    expect(result.steps["apply-promotion"].status).toBe("skipped");
    expect(result.emitted.some((e) => e.event === "autonomy.backlog.promoted")).toBe(false);
  });
});
