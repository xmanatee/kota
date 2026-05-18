import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/testing-api.js";
import {
  computeResourceFingerprint,
  renderRetryMarker,
} from "../research-retry/precondition.js";
import dispatcherWorkflow from "./workflow.js";

function taskFixture(
  id: string,
  state: "ready" | "doing" | "backlog" | "blocked",
  options: {
    anchor?: boolean;
    dependsOn?: string[];
    resources?: string[];
    marker?: string;
  } = {},
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    "priority: p2",
    "area: modules",
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

  it("emits autonomy.queue.available when ready tasks exist", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-foo.md"),
      taskFixture("task-foo", "ready"),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
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
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
  });

  it("emits autonomy.queue.empty without thin when only dependency-blocked backlog remains", async () => {
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
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
    const emptyEvent = result.emitted.find((e) => e.event === "autonomy.queue.empty");
    const emptyPayload = emptyEvent?.payload as { dependencyBlockedTasks?: unknown[] } | undefined;
    expect(emptyPayload?.dependencyBlockedTasks).toEqual(
      expect.arrayContaining(dependencyBlockedTasks),
    );
    expect(emptyPayload?.dependencyBlockedTasks).toHaveLength(2);
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
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(true);
  });

  it("does not emit needs-promotion when only strategic anchor backlog remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-anchor.md"),
      taskFixture("task-anchor", "backlog", { anchor: true }),
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(output.promotableBacklogCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
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
