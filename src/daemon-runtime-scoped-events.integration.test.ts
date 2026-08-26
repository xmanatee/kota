import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { EventJournal } from "#core/events/event-journal.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { AUTONOMY_SOURCE_EVENT_NAMES } from "#root/daemon-runtime-event-fixture.integration.js";
import {
  emitWarningFamily,
  projectionContains,
  startRuntimeRoutingScenario,
  waitForRuntimeEvidence,
} from "#root/daemon-runtime-routing-fixture.integration.js";

describe("daemon runtime scoped autonomy events", () => {
  let rootDir: string;
  let scopeRoot: string;
  let stateDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-runtime-scopes-"));
    scopeRoot = join(rootDir, "scope-a");
    stateDir = join(scopeRoot, ".kota");
    mkdirSync(stateDir, { recursive: true });
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("routes every source family through one production daemon across two scopes", async () => {
    const scenario = await startRuntimeRoutingScenario({ rootDir, scopeRoot, stateDir });
    const {
      eventBus,
      scopeB,
      fixtureA,
      fixtureB,
      decisions,
      runtimeA,
      runtimeB,
    } = scenario;
    const scopeAId = deriveDirectoryScopeId(scopeRoot);
    const scopeBId = deriveDirectoryScopeId(scopeB);
    try {
      for (const event of AUTONOMY_SOURCE_EVENT_NAMES) {
        expect(scenario.sourceListenerCounts.get(event), `${event} onLoad subscriber`).toBeGreaterThan(0);
        expect(eventBus.listenerCount(event)).toBeGreaterThanOrEqual(
          scenario.sourceListenerCounts.get(event)!,
        );
      }

      const baselineIssueKeys = new Map([
        [scopeAId, new Set(readAutonomyIssueProjection(scopeRoot).issues.map((issue) => issue.issueKey))],
        [scopeBId, new Set(readAutonomyIssueProjection(scopeB).issues.map((issue) => issue.issueKey))],
      ]);
      const baselineRunCounts = new Map([
        [scopeAId, runtimeA.runStore.listRuns({ workflow: "autonomy-health-reviewer", limit: 20 }).length],
        [scopeBId, runtimeB.runStore.listRuns({ workflow: "autonomy-health-reviewer", limit: 20 }).length],
      ]);
      const baselineDecisionKeys = new Set(
        decisions.map((decision) => `${decision.scopeId}:${decision.issueKey}`),
      );

      fixtureA.emitFailure();
      fixtureB.emitFailure();
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key.startsWith("workflow:builder:failure:")) &&
          projectionContains(scopeB, (key) => key.startsWith("workflow:builder:failure:")),
        "workflow failures did not reach both scoped projections",
      );

      emitWarningFamily({
        scenario,
        emit: fixtureA.emitReview,
        scopeId: scopeAId,
        predicate: (signal) => signal.source.kind === "review",
      });
      emitWarningFamily({
        scenario,
        emit: fixtureB.emitReview,
        scopeId: scopeBId,
        predicate: (signal) => signal.source.kind === "review",
      });
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key === "review-scrutiny:critic:builder:task-a") &&
          projectionContains(scopeB, (key) => key === "review-scrutiny:critic:builder:task-b"),
        "review scrutiny did not reach both scoped projections",
      );

      emitWarningFamily({
        scenario,
        emit: fixtureA.emitTrajectory,
        scopeId: scopeAId,
        predicate: (signal) => signal.labels.includes("trajectory"),
      });
      emitWarningFamily({
        scenario,
        emit: fixtureB.emitTrajectory,
        scopeId: scopeBId,
        predicate: (signal) => signal.labels.includes("trajectory"),
      });
      const trajectoryRoot = "workflow:builder:trajectory:build:missing_final_verification_after_edit";
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key === trajectoryRoot) &&
          projectionContains(scopeB, (key) => key === trajectoryRoot),
        "trajectory evidence did not reach both scoped projections",
      );

      emitWarningFamily({
        scenario,
        emit: fixtureA.emitOwnerAnswer,
        scopeId: scopeAId,
        predicate: (signal) => signal.source.kind === "owner-question",
      });
      emitWarningFamily({
        scenario,
        emit: fixtureB.emitOwnerAnswer,
        scopeId: scopeBId,
        predicate: (signal) => signal.source.kind === "owner-question",
      });
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key === "owner-intervention:a-owner-decision") &&
          projectionContains(scopeB, (key) => key === "owner-intervention:b-owner-decision"),
        "owner-question evidence did not reach both scoped projections",
      );

      fixtureA.emitDeadLetter();
      fixtureB.emitDeadLetter();
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key.startsWith("workflow:progress-reviewer:failure:")) &&
          projectionContains(scopeB, (key) => key.startsWith("workflow:progress-reviewer:failure:")),
        "dead letters did not reach both scoped projections",
      );

      fixtureA.emitBuilderInterruption();
      fixtureB.emitBuilderInterruption();
      await waitForRuntimeEvidence(
        () =>
          projectionContains(scopeRoot, (key) => key === "workflow:builder:interrupted-run") &&
          projectionContains(scopeB, (key) => key === "workflow:builder:interrupted-run"),
        "builder interruptions did not reach both scoped projections",
      );

      const projectionA = readAutonomyIssueProjection(scopeRoot);
      const projectionB = readAutonomyIssueProjection(scopeB);
      const sourceIssuesA = projectionA.issues.filter(
        (issue) => !baselineIssueKeys.get(scopeAId)!.has(issue.issueKey),
      );
      const sourceIssuesB = projectionB.issues.filter(
        (issue) => !baselineIssueKeys.get(scopeBId)!.has(issue.issueKey),
      );
      expect(sourceIssuesA).toHaveLength(6);
      expect(sourceIssuesB).toHaveLength(6);
      expect(projectionA.issues.some((issue) => issue.rootCauseKey.includes("task-b"))).toBe(false);
      expect(projectionB.issues.some((issue) => issue.rootCauseKey.includes("task-a"))).toBe(false);
      for (const [scopeId, sourceIssues] of [[scopeAId, sourceIssuesA], [scopeBId, sourceIssuesB]] as const) {
        for (const issue of sourceIssues) {
          expect(decisions.filter(
            (decision) => decision.scopeId === scopeId && decision.issueKey === issue.issueKey,
          )).toHaveLength(1);
        }
      }
      const newDecisionKeys = new Set(
        decisions
          .map((decision) => `${decision.scopeId}:${decision.issueKey}`)
          .filter((key) => !baselineDecisionKeys.has(key)),
      );
      expect(newDecisionKeys.size).toBe(12);

      for (const runtime of [runtimeA, runtimeB]) {
        const runs = runtime.runStore.listRuns({ workflow: "autonomy-health-reviewer", limit: 20 });
        expect(runs).toHaveLength(baselineRunCounts.get(runtime.scope.scopeId)! + 6);
        expect(runs.every((run) => run.status === "success")).toBe(true);
        expect(runs.every((run) => existsSync(
          join(runtime.scope.scopeRoot, run.runDir, "autonomy-health-review.json"),
        ))).toBe(true);
      }

      const journal = new EventJournal(join(stateDir, "events"));
      for (const [scopeId, issues] of [[scopeAId, sourceIssuesA], [scopeBId, sourceIssuesB]] as const) {
        for (const event of AUTONOMY_SOURCE_EVENT_NAMES) {
          expect(journal.query({ type: event, scopeId }).length).toBeGreaterThan(0);
        }
        expect(journal.query({ type: autonomyHealthSignal.name, scopeId }).length).toBeGreaterThan(0);
        const issueKeys = new Set(issues.map((issue) => issue.issueKey));
        expect(journal.query({ type: autonomyIssueDecisionRequested.name, scopeId }).filter(
          (entry) => entry.payload.kind === "inline" && issueKeys.has(String(entry.payload.payload.issueKey)),
        )).toHaveLength(6);
      }

      const scopeBBeforeForeignEvent = fixtureB.snapshotSourceStores();
      fixtureA.emitFailure("a second isolated failure");
      await waitForRuntimeEvidence(
        () => readAutonomyIssueProjection(scopeRoot).issues.length === projectionA.issues.length + 1,
        "scope A follow-up failure was not projected",
      );
      expect(fixtureB.snapshotSourceStores()).toEqual(scopeBBeforeForeignEvent);

      const scopeAAfterOwnEvent = fixtureA.snapshotSourceStores();
      fixtureB.emitFailure("b second isolated failure");
      await waitForRuntimeEvidence(
        () => readAutonomyIssueProjection(scopeB).issues.length === projectionB.issues.length + 1,
        "scope B follow-up failure was not projected",
      );
      expect(fixtureA.snapshotSourceStores()).toEqual(scopeAAfterOwnEvent);

      const scopeABeforeInvalid = fixtureA.snapshotSourceStores();
      const scopeBBeforeInvalid = fixtureB.snapshotSourceStores();
      expect(() => eventBus.emit("workflow.failure.alert", {
        scopeId: "unknown-scope",
        workflow: "builder",
        runId: "unknown-run",
        status: "failed",
        durationMs: 1,
        errorSummary: "unknown",
        text: "unknown",
      })).toThrow(/unknown scope unknown-scope/);
      expect(fixtureA.snapshotSourceStores()).toEqual(scopeABeforeInvalid);
      expect(fixtureB.snapshotSourceStores()).toEqual(scopeBBeforeInvalid);
    } finally {
      await scenario.stop();
    }
    for (const event of AUTONOMY_SOURCE_EVENT_NAMES) {
      expect(scenario.eventBus.listenerCount(event)).toBe(0);
    }
  });
});
