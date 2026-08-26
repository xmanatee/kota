import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { WorkflowTestHarness } from "#core/workflow/testing/testing-api.js";
import {
  computeResourceFingerprint,
  renderRetryMarker,
} from "../research-retry/precondition.js";
import { scopeImprovementChanged } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import {
  emptyScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "../scope-improver/scope-policy-test-support.js";
import dispatcherWorkflow from "./workflow.js";

function taskFixture(
  id: string,
  state: "ready" | "doing" | "backlog" | "blocked",
  options: {
    anchor?: boolean;
    dependsOn?: string[];
    resources?: string[];
    marker?: string;
    priority?: "p0" | "p1" | "p2" | "p3";
    taskClass?: "Product" | "Safety" | "Platform" | "Meta";
  } = {},
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    `priority: ${options.priority ?? "p2"}`,
    "area: modules",
    ...(options.taskClass ? [`task_class: ${options.taskClass}`] : []),
    `summary: ${id} summary`,
    "created_at: 2026-05-08T00:00:00.000Z",
    "updated_at: 2026-05-08T00:00:00.000Z",
    ...(options.anchor ? ["anchor: true"] : []),
    ...(options.dependsOn ? [`depends_on: [${options.dependsOn.join(", ")}]`] : []),
    "---",
    "",
    ...(options.resources
      ? [
          "## Resources",
          "",
          ...options.resources.map((url) => `- ${url}`),
          "",
        ]
      : []),
    ...(options.marker ? [options.marker, ""] : []),
  ].join("\n");
}

describe("dispatcher workflow", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-dispatcher-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "backlog"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "blocked"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "done"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "dropped"), { recursive: true });
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
    mkdirSync(join(projectDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function git(args: readonly string[]): string {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function writeProjectFile(path: string, content: string): void {
    const fullPath = join(projectDir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  function commitAll(message: string): string {
    git(["add", "."]);
    git([
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    ]);
    return git(["rev-parse", "HEAD"]);
  }

  function writeSecurityReviewEvidence(args: {
    runId: string;
    completedAt: string;
    commitSha: string;
  }): void {
    const runDir = join(projectDir, ".kota", "runs", args.runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      `${JSON.stringify(
        {
          id: args.runId,
          workflow: "security-review",
          status: "success",
          completedAt: args.completedAt,
          steps: [{ id: "commit", output: { sha: args.commitSha } }],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    writeFileSync(
      join(runDir, "security-review-outcome.json"),
      `${JSON.stringify({ outcome: "no-op", reason: "test-review" }, null, 2)}\n`,
      "utf-8",
    );
  }

  it("emits one targeted autonomy.queue.available event per ready task", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-foo.md"),
      taskFixture("task-foo", "ready"),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-bar.md"),
      taskFixture("task-bar", "ready"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(2);
    expect(output.actionableCount).toBe(2);
    expect(output.dispatchableCount).toBe(2);
    expect(
      result.emitted
        .filter((event) => event.event === "autonomy.queue.available")
        .map((event) => event.payload.taskId)
        .sort(),
    ).toEqual(["task-bar", "task-foo"]);
    expect(
      result.emitted
        .filter((event) => event.event === "autonomy.queue.available")
        .every((event) =>
          typeof event.payload.taskDigest === "string" &&
          event.payload.idempotencyKey ===
            `builder:${event.payload.taskId}:${event.payload.taskDigest}`
        ),
    ).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
  });

  it("promotes a better backlog frontier before dispatching the builder", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-platform-ready.md"),
      taskFixture("task-platform-ready", "ready", {
        priority: "p2",
        taskClass: "Platform",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-product-backlog.md"),
      taskFixture("task-product-backlog", "backlog", {
        priority: "p1",
        taskClass: "Product",
      }),
    );

    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<
      string,
      unknown
    >;
    expect(output.actionableCount).toBe(1);
    expect(output.promotionFrontier).toMatchObject({
      incumbentTaskId: "task-platform-ready",
      improved: true,
    });
    expect(
      result.emitted.some(
        (event) => event.event === "autonomy.queue.needs-promotion",
      ),
    ).toBe(true);
    expect(
      result.emitted.some((event) => event.event === "autonomy.queue.available"),
    ).toBe(false);
  });

  it("does not treat ready work with unfinished hard dependencies as actionable", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-dependent.md"),
      taskFixture("task-dependent", "ready", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-enabler.md"),
      taskFixture("task-enabler", "backlog"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.dependencyBlockedTasks).toEqual([
      {
        id: "task-dependent",
        title: "task-dependent",
        state: "ready",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ]);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("treats ready work as actionable once hard dependencies are done", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-dependent.md"),
      taskFixture("task-dependent", "ready", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "done", "task-enabler.md"),
      taskFixture("task-enabler", "backlog").replace("status: backlog", "status: done"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.actionableCount).toBe(1);
    expect(output.dependencyBlockedTasks).toEqual([]);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(true);
  });

  it("emits autonomy.inbox.available when inbox has items", async () => {
    writeFileSync(join(projectDir, "data", "inbox", "idea.md"), "Some idea\n");
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.inboxCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.inbox.available")).toBe(true);
  });

  it("emits autonomy.queue.empty when nothing to do", async () => {
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.dispatchableCount).toBe(0);
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
  });

  it("stays quiescent when only dependency-blocked backlog remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-dependent-a.md"),
      taskFixture("task-dependent-a", "backlog", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-dependent-b.md"),
      taskFixture("task-dependent-b", "backlog", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-enabler.md"),
      taskFixture("task-enabler", "blocked"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const dependencyBlockedTasks = [
      {
        id: "task-dependent-a",
        title: "task-dependent-a",
        state: "backlog",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
      {
        id: "task-dependent-b",
        title: "task-dependent-b",
        state: "backlog",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ];
    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(0);
    expect(output.actionableCount).toBe(0);
    expect(output.dependencyBlockedTasks).toEqual(expect.arrayContaining(dependencyBlockedTasks));
    expect(output.dependencyBlockedTasks).toHaveLength(2);
    expect(output.quiescent).toBe(true);
    expect(output.quiescentReason).toBe("work is dependency-blocked");
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
  });

  it("emits autonomy.queue.needs-promotion when only backlog work remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      taskFixture("task-foo", "backlog"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(output.promotableBacklogCount).toBe(1);
    expect(output.dispatchableCount).toBe(1);
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(true);
  });

  it("treats strategic-anchor-only backlog as empty dispatchable work", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-anchor.md"),
      taskFixture("task-anchor", "backlog", { anchor: true }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(0);
    expect(output.actionableCount).toBe(0);
    expect(output.promotableBacklogCount).toBe(0);
    expect(output.dispatchableCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(output.quiescent).toBe(false);
    expect(output.quiescentReason).toBe(null);
  });

  it("routes a dependency-clear Meta backlog task through ordinary promotion", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-meta-no-link.md"),
      taskFixture("task-meta-no-link", "backlog", { taskClass: "Meta" }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(output.promotableBacklogCount).toBe(1);
    expect(output.dispatchableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(output.quiescent).toBe(false);
  });

  it("does not emit needs-promotion when only blocked work remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-foo.md"),
      taskFixture("task-foo", "blocked"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(0);
    expect(output.actionableCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("emits blocked-research attemptable without queue.available for a blocked-only retry candidate", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-research.md"),
      taskFixture("task-research", "blocked", {
        resources: ["https://example.com/research-note"],
      }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.promotableBacklogCount).toBe(0);
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    const retryEvent = result.emitted.find(
      (e) => e.event === "autonomy.blocked-research.attemptable",
    );
    expect(retryEvent?.payload).toMatchObject({
      candidateCount: 1,
      attemptableCount: 1,
      counts: expect.objectContaining({ ready: 0, doing: 0, backlog: 0, blocked: 1 }),
    });
  });

  it("emits security-review due when security-sensitive source changed since review", async () => {
    rmSync(join(projectDir, ".git"), { recursive: true, force: true });
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeSecurityReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-dispatcher",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile(
      "src/core/modules/registry-installers.ts",
      [
        "import { spawnSync } from 'node:child_process';",
        "export async function install(url: string): Promise<void> {",
        "  spawnSync('installer', [url]);",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    );
    commitAll("touch registry installer execution");

    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const dueEvent = result.emitted.find((event) => event.event === "autonomy.security-review.due");
    expect(dueEvent?.payload).toMatchObject({
      due: true,
      reason: "high-risk-security-sensitive-change",
      changedSurfaces: [
        {
          surface: "external-fetch",
          paths: ["src/core/modules/registry-installers.ts"],
        },
        {
          surface: "tool-execution",
          paths: ["src/core/modules/registry-installers.ts"],
        },
      ],
    });
    const output = result.steps["assess-and-dispatch"].output as {
      securityReviewDue: { due: boolean; reason: string };
    };
    expect(output.securityReviewDue).toMatchObject({
      due: true,
      reason: "high-risk-security-sensitive-change",
    });
  });

  it("emits one scope review only for a changed content/policy fingerprint", async () => {
    rmSync(join(projectDir, ".git"), { recursive: true, force: true });
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    writeProjectFile(".gitignore", ".kota/\n");
    writeProjectFile("AGENTS.md", "# Scope\n\n- Initial policy.\n");
    commitAll("initial scope policy");
    const scopePolicySnapshot = scopePolicySnapshotForTest(projectDir);
    const initial = computeScopeContentFingerprint(
      projectDir,
      scopePolicySnapshot.policy,
    );
    const state = createTestTransactionalRunState();
    state.compareAndSet(
      SCOPE_IMPROVEMENT_STATE_KEY,
      0,
      {
        ...emptyScopeImprovementState(scopePolicySnapshot.policy.scopeId),
        lastRunAt: "2026-06-19T00:00:00.000Z",
        consumedFingerprint: initial.fingerprint,
      },
    );
    const changedScopePolicySnapshot = scopePolicySnapshotForTest(
      projectDir,
      [{
        scopeId: scopePolicySnapshot.policy.scopeId,
        reason: "Operator restricted writes for this scope.",
        writes: { mode: "none" },
      }],
      1,
    );

    const first = await new WorkflowTestHarness(dispatcherWorkflow, {
      projectDir,
      scopePolicySnapshot: changedScopePolicySnapshot,
      contextOverrides: { state },
    }).run();

    const evidenceEvent = first.emitted.find(
      (event) => event.event === scopeImprovementChanged.name,
    );
    expect(evidenceEvent?.payload).toMatchObject({
      automatic: true,
      boundary: "content-policy-changed",
      evidenceRefs: expect.arrayContaining([
        `scope-policy:${scopePolicySnapshot.policy.scopeId}`,
      ]),
    });
    const firstOutput = first.steps["assess-and-dispatch"].output as {
      scopeBoundary: { shouldEmit: boolean; fingerprint: string };
    };
    expect(firstOutput.scopeBoundary).toMatchObject({
      shouldEmit: true,
    });

    const second = await new WorkflowTestHarness(dispatcherWorkflow, {
      projectDir,
      scopePolicySnapshot: changedScopePolicySnapshot,
      contextOverrides: { state },
    }).run();

    expect(
      second.emitted.some(
        (event) => event.event === scopeImprovementChanged.name,
      ),
    ).toBe(false);
    const secondOutput = second.steps["assess-and-dispatch"].output as {
      scopeBoundary: { shouldEmit: boolean; reason: string };
    };
    expect(secondOutput.scopeBoundary.shouldEmit).toBe(false);
    expect(secondOutput.scopeBoundary.reason).toContain("already queued");
  });

  it("does not emit blocked-research attemptable when capability is missing", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-research.md"),
      taskFixture("task-research", "blocked", {
        resources: ["https://x.com/example/status/12345"],
      }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(0);
    expect(
      result.emitted.some((e) => e.event === "autonomy.blocked-research.attemptable"),
    ).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("does not emit blocked-research attemptable when the retry fingerprint is unchanged", async () => {
    const resources = ["https://example.com/research-note"];
    const marker = renderRetryMarker({
      fingerprint: computeResourceFingerprint(resources),
      attemptedAt: "2026-05-16T00:00:00.000Z",
    });
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-research.md"),
      taskFixture("task-research", "blocked", { resources, marker }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(0);
    expect(
      result.emitted.some((e) => e.event === "autonomy.blocked-research.attemptable"),
    ).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("emits autonomy.queue.thin for a one-item backlog tail", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      taskFixture("task-foo", "backlog"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(true);
    expect(output.quiescent).toBe(false);
    expect(output.emitted).toContain("autonomy.queue.thin");
  });

  it("emits autonomy.queue.thin when two backlog tasks remain", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      taskFixture("task-foo", "backlog"),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-bar.md"),
      taskFixture("task-bar", "backlog"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(true);
  });

  it("does not emit autonomy.queue.thin when three or more tasks remain", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-a.md"),
      taskFixture("task-a", "ready"),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-b.md"),
      taskFixture("task-b", "backlog"),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-c.md"),
      taskFixture("task-c", "backlog"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
  });

  it("does not emit autonomy.queue.empty when doing work still exists", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "doing", "task-foo.md"),
      taskFixture("task-foo", "doing"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(true);
  });

  it("emits both queue.available and inbox.available when both have items", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-bar.md"),
      taskFixture("task-bar", "ready"),
    );
    writeFileSync(join(projectDir, "data", "inbox", "idea.md"), "Some idea\n");
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const emittedEvents = result.emitted.map((e) => e.event);
    expect(emittedEvents).toContain("autonomy.queue.available");
    expect(emittedEvents).toContain("autonomy.inbox.available");
    expect(emittedEvents).not.toContain("autonomy.queue.empty");
  });
});
