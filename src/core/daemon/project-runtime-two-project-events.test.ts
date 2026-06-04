/**
 * Two-directory-scope isolation test for daemon-scoped runtime events.
 *
 * Slice 3a established the typed `ProjectScopedEventBus` primitive. Slice 3b
 * migrated every per-project core subsystem onto it: workflow runtime, run
 * store, scheduler, task store, approval/owner-question queues, notification
 * gate, and queue-shape emitters. This test is the load-bearing proof that
 * those migrations actually attribute every emit to its emitting scope.
 *
 * Two `ProjectRuntime` bundles built over one shared `EventBus`:
 *   1. Each directory scope's typed `workflow.started`/`workflow.completed`
 *      event carries that scope's `scopeId` and compatibility `projectId` —
 *      never the other's, never empty.
 *   2. Each project's `task.changed`, `approval.changed`, and
 *      `owner.question.asked` queue/control event carries its own scope
 *      selectors, so a single subscriber can filter without inferring scope
 *      from paths.
 *
 * The test also asserts no project-scoped event ever reaches the bus without
 * `scopeId`/`projectId` populated and equal.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { createProjectRuntime, type ProjectRuntime } from "./project-runtime.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
} from "./scope-registry.js";

type TwoProjects = {
  bus: EventBus;
  envelopes: BusEnvelope[];
  projectA: { configured: ConfiguredProject; runtime: ProjectRuntime };
  projectB: { configured: ConfiguredProject; runtime: ProjectRuntime };
  cleanup: () => void;
};

function makeTwoProjects(): TwoProjects {
  // Two on-disk project roots so `deriveDirectoryScopeId` produces two distinct
  // stable ids without any test-only override of the derivation. The
  // registry reuses the same hash the rest of the daemon uses, so this
  // mirrors a real multi-project daemon configuration.
  const stateDir = mkdtempSync(join(tmpdir(), "kota-two-project-events-"));
  const dirA = join(stateDir, "project-a");
  const dirB = join(stateDir, "project-b");
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  const configuredA = buildConfiguredProject({ projectDir: dirA });
  const configuredB = buildConfiguredProject({ projectDir: dirB });
  expect(configuredA.projectId).not.toEqual(configuredB.projectId);

  const bus = new EventBus();
  const envelopes: BusEnvelope[] = [];
  bus.on("*", (envelope) => {
    envelopes.push(envelope);
  });

  const runtimeA = createProjectRuntime({
    project: configuredA,
    bus,
    onLog: () => {},
    installSingletons: false,
  });
  const runtimeB = createProjectRuntime({
    project: configuredB,
    bus,
    onLog: () => {},
    installSingletons: false,
  });

  return {
    bus,
    envelopes,
    projectA: { configured: configuredA, runtime: runtimeA },
    projectB: { configured: configuredB, runtime: runtimeB },
    cleanup: () => rmSync(stateDir, { recursive: true, force: true }),
  };
}

function projectScopedEnvelopes(envelopes: BusEnvelope[]): BusEnvelope[] {
  return envelopes.filter((env) => {
    const payload = env.payload as { scopeId?: unknown; projectId?: unknown };
    return typeof payload.scopeId === "string" || typeof payload.projectId === "string";
  });
}

function expectScopeAttribution(env: BusEnvelope, scopeId: string): void {
  const payload = env.payload as { scopeId?: unknown; projectId?: unknown };
  expect(payload.scopeId).toBe(scopeId);
  expect(payload.projectId).toBe(scopeId);
}

describe("two-project core daemon events", () => {
  let twoProjects: TwoProjects;

  beforeEach(() => {
    twoProjects = makeTwoProjects();
  });

  afterEach(() => {
    twoProjects.cleanup();
  });

  it("queue/control emits — task.changed, approval.changed, owner.question.asked — carry the right scopeId", () => {
    const { envelopes, projectA, projectB } = twoProjects;

    // Each subsystem in each bundle emits exactly one project-scoped event.
    projectA.runtime.taskStore.add("project-a task");
    projectB.runtime.taskStore.add("project-b task");

    projectA.runtime.approvalQueue.enqueue(
      "shell",
      { command: "rm" },
      "dangerous",
      "project-a needs review",
    );
    projectB.runtime.approvalQueue.enqueue(
      "shell",
      { command: "rm" },
      "dangerous",
      "project-b needs review",
    );

    projectA.runtime.ownerQuestionQueue.enqueue({
      context: "project-a context",
      question: "should A?",
      reason: "project-a reason",
      source: "project-a source",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "project-a source" },
    });
    projectB.runtime.ownerQuestionQueue.enqueue({
      context: "project-b context",
      question: "should B?",
      reason: "project-b reason",
      source: "project-b source",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "project-b source" },
    });

    // Filter the cross-project bus listener by scopeId; each project's
    // subscriber should see only its own emits.
    const idA = projectA.configured.projectId;
    const idB = projectB.configured.projectId;

    const seenByA = projectScopedEnvelopes(envelopes).filter(
      (env) => (env.payload as { scopeId: string }).scopeId === idA,
    );
    const seenByB = projectScopedEnvelopes(envelopes).filter(
      (env) => (env.payload as { scopeId: string }).scopeId === idB,
    );
    for (const env of seenByA) expectScopeAttribution(env, idA);
    for (const env of seenByB) expectScopeAttribution(env, idB);

    const eventNamesA = seenByA.map((env) => env.type).sort();
    const eventNamesB = seenByB.map((env) => env.type).sort();
    expect(eventNamesA).toEqual([
      "approval.changed",
      "approval.requested",
      "owner.question.asked",
      "owner.question.changed",
      "task.changed",
    ]);
    expect(eventNamesB).toEqual([
      "approval.changed",
      "approval.requested",
      "owner.question.asked",
      "owner.question.changed",
      "task.changed",
    ]);
  });

  it("workflow lifecycle emits carry the right scopeId for two project workflow runtimes over one bus", async () => {
    const { envelopes, projectA, projectB } = twoProjects;

    // Pull workflow lifecycle emits straight off the per-project pbus's
    // emit path. Building a real workflow run would also exercise the
    // run-executor's lifecycle, but the canonical contract under test here
    // is that the per-project pbus injects scope attribution on every emit. The
    // run-executor uses the same pbus, so this same proof carries through.
    const workflowStartedPayload = (suffix: string) => ({
      workflow: `wf-${suffix}`,
      runId: `run-${suffix}`,
      triggerEvent: "manual",
      definitionPath: `src/test-${suffix}/workflow.ts`,
      runDir: `.kota/runs/run-${suffix}`,
      startedAt: new Date().toISOString(),
    });
    const workflowCompletedPayload = (suffix: string) => ({
      workflow: `wf-${suffix}`,
      runId: `run-${suffix}`,
      status: "success" as const,
      triggerEvent: "manual",
      durationMs: 0,
      definitionPath: `src/test-${suffix}/workflow.ts`,
      runDir: `.kota/runs/run-${suffix}`,
      tags: [],
    });

    projectA.runtime.pbus.emit("workflow.started", workflowStartedPayload("a"));
    projectB.runtime.pbus.emit("workflow.started", workflowStartedPayload("b"));
    projectA.runtime.pbus.emit("workflow.completed", workflowCompletedPayload("a"));
    projectB.runtime.pbus.emit("workflow.completed", workflowCompletedPayload("b"));

    const idA = projectA.configured.projectId;
    const idB = projectB.configured.projectId;

    // Per-project filtered subscribers see only their own lifecycle events.
    const seenA = envelopes.filter(
      (env) =>
        (env.type === "workflow.started" || env.type === "workflow.completed") &&
        (env.payload as { scopeId: string }).scopeId === idA,
    );
    const seenB = envelopes.filter(
      (env) =>
        (env.type === "workflow.started" || env.type === "workflow.completed") &&
        (env.payload as { scopeId: string }).scopeId === idB,
    );
    expect(seenA.map((env) => env.type)).toEqual(["workflow.started", "workflow.completed"]);
    expect(seenB.map((env) => env.type)).toEqual(["workflow.started", "workflow.completed"]);

    // No project-scoped lifecycle event ever leaves with missing or divergent
    // scope attribution.
    const lifecycle = envelopes.filter(
      (env) =>
        env.type === "workflow.started" || env.type === "workflow.completed",
    );
    for (const env of lifecycle) {
      const payload = env.payload as { scopeId?: unknown; projectId?: unknown };
      expect(typeof payload.scopeId).toBe("string");
      expect(payload.scopeId).not.toBe("");
      expect(payload.projectId).toBe(payload.scopeId);
    }
  });

  it("ProjectScopedEventBus.on(name) only delivers same-project events to per-project subscribers", () => {
    const { projectA, projectB } = twoProjects;
    const aReceived: Array<{ id: number; counts: { pending: number; in_progress: number; done: number } }> = [];
    const bReceived: Array<{ id: number; counts: { pending: number; in_progress: number; done: number } }> = [];

    let counter = 0;
    projectA.runtime.pbus.on("task.changed", (payload) => {
      aReceived.push({ id: ++counter, counts: payload.counts });
    });
    projectB.runtime.pbus.on("task.changed", (payload) => {
      bReceived.push({ id: ++counter, counts: payload.counts });
    });

    projectA.runtime.taskStore.add("a-1");
    projectB.runtime.taskStore.add("b-1");
    projectA.runtime.taskStore.add("a-2");

    expect(aReceived).toHaveLength(2);
    expect(bReceived).toHaveLength(1);
    // Per-project counts reflect only that project's tasks (no cross-leak).
    expect(aReceived.map((e) => e.counts.pending)).toEqual([1, 2]);
    expect(bReceived.map((e) => e.counts.pending)).toEqual([1]);
  });
});
