import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/testing-api.js";
import dispatcherWorkflow from "./workflow.js";

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
      "---\nid: task-foo\ntitle: Foo\nstatus: ready\npriority: p2\n---\n",
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

  it("emits autonomy.queue.needs-promotion when only backlog work remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      "---\nid: task-foo\ntitle: Foo\nstatus: backlog\npriority: p2\n---\n",
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    const output = result.steps["assess-and-dispatch"].output as Record<string, unknown>;
    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.needs-promotion")).toBe(true);
  });

  it("does not emit needs-promotion when only blocked work remains", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-foo.md"),
      "---\nid: task-foo\ntitle: Foo\nstatus: blocked\npriority: p2\n---\n",
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

  it("emits autonomy.queue.thin for a one-item backlog tail", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      "---\nid: task-foo\ntitle: Foo\nstatus: backlog\npriority: p2\n---\n",
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
      "---\nid: task-foo\ntitle: Foo\nstatus: backlog\npriority: p2\n---\n",
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-bar.md"),
      "---\nid: task-bar\ntitle: Bar\nstatus: backlog\npriority: p2\n---\n",
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(true);
  });

  it("does not emit autonomy.queue.thin when three or more tasks remain", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-a.md"),
      "---\nid: task-a\ntitle: A\nstatus: ready\npriority: p2\n---\n",
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-b.md"),
      "---\nid: task-b\ntitle: B\nstatus: backlog\npriority: p2\n---\n",
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-c.md"),
      "---\nid: task-c\ntitle: C\nstatus: backlog\npriority: p2\n---\n",
    );
    const harness = new WorkflowTestHarness(dispatcherWorkflow, { projectDir });
    const result = await harness.run();

    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
  });

  it("does not emit autonomy.queue.empty when doing work still exists", async () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "doing", "task-foo.md"),
      "---\nid: task-foo\ntitle: Foo\nstatus: doing\npriority: p2\n---\n",
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
      "---\nid: task-bar\ntitle: Bar\nstatus: ready\npriority: p2\n---\n",
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
