import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import {
  applyScopeSignals,
  emitReview,
  emitTrajectory,
  interruptedBuilderRun,
  makeRuntime,
  type ScopedHealthSignal,
  writeRun,
} from "./autonomy-issue-multi-scope.test-helpers.js";
import {
  AUTONOMY_ISSUE_PROJECTION_FILE,
  readAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import {
  autonomyHealthSignal,
} from "./health-signal.js";

describe("multi-scope autonomy issue source routing", () => {
  let rootDir: string;
  let projectA: string;
  let projectB: string;
  let bus: EventBus;
  let runtimeA: ProjectRuntime;
  let runtimeB: ProjectRuntime;
  let signals: ScopedHealthSignal[];

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-issue-multi-scope-"));
    projectA = join(rootDir, "project-a");
    projectB = join(rootDir, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    bus = new EventBus();
    runtimeA = makeRuntime(projectA, "scope-a", bus);
    runtimeB = makeRuntime(projectB, "scope-b", bus);
    const registry = new ProviderRegistry();
    const runtimes = new Map([
      [runtimeA.project.projectId, runtimeA],
      [runtimeB.project.projectId, runtimeB],
    ]);
    registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "test", {
      resolve: (scopeId) => {
        const runtime = runtimes.get(scopeId);
        return runtime
          ? { ok: true, runtime }
          : { ok: false, projectId: scopeId };
      },
    });
    signals = [];
    bus.on(autonomyHealthSignal, (signal) => signals.push(signal));
    subscribeAutonomyIssueSources({
      events: makeStubEventProxy(bus),
      getProvider: (token) => registry.get(token),
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("keeps interleaved failure, review, owner, DLQ, and interruption evidence in its owning scope", () => {
    for (const runtime of [runtimeA, runtimeB]) {
      runtime.pbus.emit("workflow.failure.alert", {
        workflow: "builder",
        runId: `failure-${runtime.project.projectId}`,
        status: "failed",
        durationMs: 1000,
        errorSummary: "Shared builder failure 17 at abcdef1234567",
        text: "builder failed",
      });
    }

    emitReview(runtimeA, "task-a");
    emitReview(runtimeB, "task-b");
    emitTrajectory(runtimeA);

    const question = runtimeB.ownerQuestionQueue.enqueue({
      dedupeKey: "scope-b-owner-decision",
      context: "Only scope B owns this decision.",
      question: "Choose the scope B recovery path?",
      reason: "The repository cannot infer the owner policy.",
      source: "multi-scope-fixture",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "test" },
    });
    runtimeB.ownerQuestionQueue.answer(question.id, "Preserve work", "test");

    createWorkflowDispatchDeadLetter({
      store: runtimeA.deadLetterQueue,
      scopeId: "scope-a",
      workflowName: "progress-reviewer",
      trigger: {
        event: "autonomy.progress-review.requested",
        schemaRef: null,
        payload: {},
      },
      reason: "Scope A review dispatch failed",
      errorClass: "execution",
      failedRun: {
        ...interruptedBuilderRun("review-failure-a"),
        workflow: "progress-reviewer",
        status: "failed",
      },
    });

    writeRun(runtimeB, interruptedBuilderRun("builder-interrupted-b"));
    runtimeB.pbus.emit("workflow.interrupted.alert", {
      workflow: "builder",
      runId: "builder-interrupted-b",
      durationMs: 1000,
      reason: "daemon restart",
      text: "builder interrupted",
    });

    expect(signals.filter((signal) => signal.scopeId === "scope-a")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: "scope-a", source: expect.objectContaining({ id: "builder" }) }),
        expect.objectContaining({ projectId: "scope-a", source: expect.objectContaining({ id: "critic" }) }),
        expect.objectContaining({ projectId: "scope-a", labels: expect.arrayContaining(["trajectory"]) }),
        expect.objectContaining({ projectId: "scope-a", source: expect.objectContaining({ id: "progress-reviewer" }) }),
      ]),
    );
    expect(signals.filter((signal) => signal.scopeId === "scope-b")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: "scope-b", source: expect.objectContaining({ id: "builder" }) }),
        expect.objectContaining({ projectId: "scope-b", source: expect.objectContaining({ id: "critic" }) }),
        expect.objectContaining({ projectId: "scope-b", source: expect.objectContaining({ kind: "owner-question" }) }),
        expect.objectContaining({ projectId: "scope-b", labels: expect.arrayContaining(["interrupted-run"]) }),
      ]),
    );

    const scopeASignals = signals.filter((signal) => signal.scopeId === "scope-a");
    const scopeBSignals = signals.filter((signal) => signal.scopeId === "scope-b");
    applyScopeSignals(projectA, scopeASignals);
    applyScopeSignals(projectB, scopeBSignals);

    const projectionA = readAutonomyIssueProjection(projectA);
    const projectionB = readAutonomyIssueProjection(projectB);
    expect(projectionA.issues.some((issue) =>
      issue.rootCauseKey === "review-scrutiny:critic:builder:task-a"
    )).toBe(true);
    expect(projectionA.issues.some((issue) =>
      issue.rootCauseKey === "review-scrutiny:critic:builder:task-b"
    )).toBe(false);
    expect(projectionB.issues.some((issue) =>
      issue.rootCauseKey === "review-scrutiny:critic:builder:task-b"
    )).toBe(true);
    expect(projectionB.issues.some((issue) =>
      issue.rootCauseKey === "review-scrutiny:critic:builder:task-a"
    )).toBe(false);
    expect(
      projectionA.issues.find((issue) => issue.source.id === "builder")?.rootCauseKey,
    ).toBe(
      projectionB.issues.find((issue) => issue.source.id === "builder")?.rootCauseKey,
    );

    const projectionBPath = join(projectB, AUTONOMY_ISSUE_PROJECTION_FILE);
    const projectBBeforeForeignEvent = readFileSync(projectionBPath, "utf-8");
    const signalCountBeforeForeignEvent = signals.length;
    runtimeA.pbus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "another-scope-a-failure",
      status: "failed",
      durationMs: 1000,
      errorSummary: "A different scope A failure",
      text: "builder failed",
    });
    applyScopeSignals(projectA, signals.slice(signalCountBeforeForeignEvent));
    expect(readFileSync(projectionBPath, "utf-8")).toBe(projectBBeforeForeignEvent);
  });

  it("rejects unknown and conflicting selectors without touching either project", () => {
    const projectionAPath = join(projectA, AUTONOMY_ISSUE_PROJECTION_FILE);
    const projectionBPath = join(projectB, AUTONOMY_ISSUE_PROJECTION_FILE);
    expect(() => bus.emit("workflow.failure.alert", {
      projectId: "unknown-scope",
      workflow: "builder",
      runId: "unknown-run",
      status: "failed",
      durationMs: 1,
      errorSummary: "unknown",
      text: "unknown",
    })).toThrow(/unknown scope unknown-scope/);
    expect(() => bus.emit("workflow.failure.alert", {
      scopeId: "scope-a",
      projectId: "scope-b",
      workflow: "builder",
      runId: "conflicting-run",
      status: "failed",
      durationMs: 1,
      errorSummary: "conflicting",
      text: "conflicting",
    })).toThrow(/conflicting scope selectors/);
    expect(() => readFileSync(projectionAPath, "utf-8")).toThrow();
    expect(() => readFileSync(projectionBPath, "utf-8")).toThrow();
    expect(signals).toEqual([]);
  });
});
