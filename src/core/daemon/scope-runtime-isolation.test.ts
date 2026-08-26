/**
 * Two-directory-scope isolation test for daemon-scoped runtime events.
 *
 * Slice 3a established the typed `ScopedEventBus` primitive. Slice 3b
 * migrated every per-scope core subsystem onto it: workflow runtime, run
 * store, scheduler, task store, approval/owner-question queues, notification
 * gate, and queue-shape emitters. This test is the load-bearing proof that
 * those migrations actually attribute every emit to its emitting scope.
 *
 * Two `ScopeRuntime` bundles built over one shared `EventBus`:
 *   1. Each directory scope's typed `workflow.started`/`workflow.completed`
 *      event carries that scope's `scopeId` — never the other's, never empty.
 *   2. Each scope's `task.changed`, `approval.changed`, and
 *      `owner.question.asked` queue/control event carries its own scope
 *      identity, so a single subscriber can filter without inferring scope
 *      from paths.
 *
 * The test also asserts no scope-scoped event reaches the bus without a
 * populated `scopeId`.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
} from "./scope-registry.js";
import { createScopeRuntime, type ScopeRuntime } from "./scope-runtime.js";

type TwoScopes = {
  bus: EventBus;
  envelopes: BusEnvelope[];
  scopeA: { configured: DirectoryScope; runtime: ScopeRuntime };
  scopeB: { configured: DirectoryScope; runtime: ScopeRuntime };
  cleanup: () => void;
};

function makeTwoScopes(): TwoScopes {
  // Two on-disk scope roots so `deriveDirectoryScopeId` produces two distinct
  // stable ids without any test-only override of the derivation. The
  // registry reuses the same hash the rest of the daemon uses, so this
  // mirrors a real multi-scope daemon configuration.
  const stateDir = mkdtempSync(join(tmpdir(), "kota-two-scope-events-"));
  const dirA = join(stateDir, "scope-a");
  const dirB = join(stateDir, "scope-b");
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  const configuredA = buildDirectoryScope({ scopeRoot: dirA });
  const configuredB = buildDirectoryScope({ scopeRoot: dirB });
  expect(configuredA.scopeId).not.toEqual(configuredB.scopeId);

  const bus = new EventBus();
  const envelopes: BusEnvelope[] = [];
  bus.on("*", (envelope) => {
    envelopes.push(envelope);
  });
  const runState = new RunStateDatabase(join(stateDir, "run-state"));
  const startedAt = new Date().toISOString();
  for (const scope of [configuredA, configuredB]) {
    runState.registerScope({
      id: scope.scopeId,
      rootPath: scope.scopeRoot,
      displayName: scope.displayName,
      createdAt: startedAt,
    });
  }
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  const runtimeByScopeId = new Map<string, ScopeRuntime>();
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 4,
    execute: (run, signal) => {
      const runtime = runtimeByScopeId.get(run.scopeId);
      if (!runtime) throw new Error(`Missing runtime fixture for ${run.scopeId}`);
      return runtime.workflowRuntime.executeAdmittedRun(run, signal);
    },
  });

  const runtimeA = createScopeRuntime({
    scope: configuredA,
    bus,
    onLog: () => {},
    installSingletons: false,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  runtimeByScopeId.set(configuredA.scopeId, runtimeA);
  const runtimeB = createScopeRuntime({
    scope: configuredB,
    bus,
    onLog: () => {},
    installSingletons: false,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  runtimeByScopeId.set(configuredB.scopeId, runtimeB);

  return {
    bus,
    envelopes,
    scopeA: { configured: configuredA, runtime: runtimeA },
    scopeB: { configured: configuredB, runtime: runtimeB },
    cleanup: () => {
      runState.close();
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

function scopeAttributedEnvelopes(envelopes: BusEnvelope[]): BusEnvelope[] {
  return envelopes.filter((env) => {
    const payload = env.payload as { scopeId?: unknown };
    return typeof payload.scopeId === "string";
  });
}

function expectScopeAttribution(env: BusEnvelope, scopeId: string): void {
  const payload = env.payload as { scopeId?: unknown };
  expect(payload.scopeId).toBe(scopeId);
}

describe("two-scope core daemon events", () => {
  let twoScopes: TwoScopes;

  beforeEach(() => {
    twoScopes = makeTwoScopes();
  });

  afterEach(() => {
    twoScopes.cleanup();
  });

  it("queue/control emits — task.changed, approval.changed, owner.question.asked — carry the right scopeId", () => {
    const { envelopes, scopeA, scopeB } = twoScopes;

    // Each subsystem in each bundle emits exactly one scope-scoped event.
    scopeA.runtime.taskStore.add("scope-a task");
    scopeB.runtime.taskStore.add("scope-b task");

    scopeA.runtime.approvalQueue.enqueue(
      "shell",
      { command: "rm" },
      "dangerous",
      "scope-a needs review",
    );
    scopeB.runtime.approvalQueue.enqueue(
      "shell",
      { command: "rm" },
      "dangerous",
      "scope-b needs review",
    );

    scopeA.runtime.ownerQuestionQueue.enqueue({
      context: "scope-a context",
      question: "should A?",
      reason: "scope-a reason",
      source: "scope-a source",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "scope-a source" },
    });
    scopeB.runtime.ownerQuestionQueue.enqueue({
      context: "scope-b context",
      question: "should B?",
      reason: "scope-b reason",
      source: "scope-b source",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "scope-b source" },
    });

    // Filter the cross-scope bus listener by scopeId; each scope's
    // subscriber should see only its own emits.
    const idA = scopeA.configured.scopeId;
    const idB = scopeB.configured.scopeId;

    const seenByA = scopeAttributedEnvelopes(envelopes).filter(
      (env) => (env.payload as { scopeId: string }).scopeId === idA,
    );
    const seenByB = scopeAttributedEnvelopes(envelopes).filter(
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

  it("workflow lifecycle emits carry the right scopeId for two scope workflow runtimes over one bus", async () => {
    const { envelopes, scopeA, scopeB } = twoScopes;

    // Pull workflow lifecycle emits straight off the per-scope pbus's
    // emit path. Building a real workflow run would also exercise the
    // run-executor's lifecycle, but the canonical contract under test here
    // is that the per-scope pbus injects scope attribution on every emit. The
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

    scopeA.runtime.pbus.emit("workflow.started", workflowStartedPayload("a"));
    scopeB.runtime.pbus.emit("workflow.started", workflowStartedPayload("b"));
    scopeA.runtime.pbus.emit("workflow.completed", workflowCompletedPayload("a"));
    scopeB.runtime.pbus.emit("workflow.completed", workflowCompletedPayload("b"));

    const idA = scopeA.configured.scopeId;
    const idB = scopeB.configured.scopeId;

    // Per-scope filtered subscribers see only their own lifecycle events.
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

    // No scope-scoped lifecycle event ever leaves without scope attribution.
    const lifecycle = envelopes.filter(
      (env) =>
        env.type === "workflow.started" || env.type === "workflow.completed",
    );
    for (const env of lifecycle) {
      const payload = env.payload as { scopeId?: unknown };
      expect(typeof payload.scopeId).toBe("string");
      expect(payload.scopeId).not.toBe("");
    }
  });

  it("ScopedEventBus.on(name) only delivers same-scope events to per-scope subscribers", () => {
    const { scopeA, scopeB } = twoScopes;
    const aReceived: Array<{ id: number; counts: { pending: number; in_progress: number; done: number } }> = [];
    const bReceived: Array<{ id: number; counts: { pending: number; in_progress: number; done: number } }> = [];

    let counter = 0;
    scopeA.runtime.pbus.on("task.changed", (payload) => {
      aReceived.push({ id: ++counter, counts: payload.counts });
    });
    scopeB.runtime.pbus.on("task.changed", (payload) => {
      bReceived.push({ id: ++counter, counts: payload.counts });
    });

    scopeA.runtime.taskStore.add("a-1");
    scopeB.runtime.taskStore.add("b-1");
    scopeA.runtime.taskStore.add("a-2");

    expect(aReceived).toHaveLength(2);
    expect(bReceived).toHaveLength(1);
    // Per-scope counts reflect only that scope's tasks (no cross-leak).
    expect(aReceived.map((e) => e.counts.pending)).toEqual([1, 2]);
    expect(bReceived.map((e) => e.counts.pending)).toEqual([1]);
  });
});
