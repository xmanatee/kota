import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { RunStateDatabase, StateValueConflictError } from "#core/workflow/run-state-database.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import {
  stageAutonomyIssueProjection,
} from "./autonomy-issue-projection-publication.js";
import type {
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
} from "./health-signal.js";

const ROOT_CAUSE = "workflow:builder:runtime-warning";

function observation(args: {
  kind?: AutonomyHealthObservation;
  runId: string;
  observedAt: string;
  severity?: AutonomyHealthSeverity;
}) {
  return buildAutonomyIssueObservation({
    kind: args.kind ?? "present",
    rootCauseKey: ROOT_CAUSE,
    observedAt: args.observedAt,
    signalIds: [`health-${args.runId}`],
    source: { kind: "workflow", id: "builder", workflow: "builder" },
    severity: args.severity ?? "warning",
    actionability: "local-code",
    labels: ["runtime"],
    summaries: ["Builder repeatedly hit the same runtime root cause."],
    evidenceRefs: [{
      kind: "run",
      ref: `.kota/runs/${args.runId}/metadata.json`,
    }],
    observationCount: 1,
  });
}

describe("durable autonomy issue projection", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("distinguishes fresh, repeated, changed and replayed evidence", () => {
    const observations = [
      observation({ runId: "run-1", observedAt: "2026-06-17T12:00:00.000Z" }),
      observation({ runId: "run-2", observedAt: "2026-06-17T13:00:00.000Z" }),
      observation({
        kind: "changed",
        runId: "run-3",
        observedAt: "2026-06-17T14:00:00.000Z",
        severity: "error",
      }),
    ];
    const reduced = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations,
    });
    expect(reduced.transitions.map(({ kind, requiresDecision }) => ({ kind, requiresDecision }))).toEqual([
      { kind: "opened", requiresDecision: true },
      { kind: "repeated", requiresDecision: false },
      { kind: "revised", requiresDecision: true },
    ]);
    const disposed = recordAutonomyIssueDispositions({
      current: reduced.projection,
      updates: [{
        issueKey: observations[0]!.issueKey,
        semanticRevision: 2,
        kind: "task",
        decidedAt: "2026-06-17T15:00:00.000Z",
        taskIds: ["task-health-builder"],
        ownerQuestionIds: [],
      }],
    });
    expect(disposed.issues[0]).toMatchObject({
      semanticRevision: 2,
      status: "open",
      disposition: { kind: "task", semanticRevision: 2 },
      links: { taskIds: ["task-health-builder"] },
    });
    const replay = applyAutonomyIssueObservations({ current: disposed, observations });
    expect(replay.transitions.every((transition) => !transition.requiresDecision)).toBe(true);
    expect(replay.projection).toEqual(disposed);
  });

  it("ignores a disposition produced for an older semantic revision", () => {
    const observations = [
      observation({ runId: "run-1", observedAt: "2026-06-17T12:00:00.000Z" }),
      observation({
        kind: "changed",
        runId: "run-2",
        observedAt: "2026-06-17T13:00:00.000Z",
        severity: "error",
      }),
    ];
    const current = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations,
    }).projection;

    expect(recordAutonomyIssueDispositions({
      current,
      updates: [{
        issueKey: observations[0]!.issueKey,
        semanticRevision: 1,
        kind: "task",
        decidedAt: "2026-06-17T14:00:00.000Z",
        taskIds: ["task-stale"],
        ownerQuestionIds: [],
      }],
    })).toBe(current);
  });

  it("stages changed state once and reads its canonical value offline", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-autonomy-publish-"));
    scopeRoots.push(workspaceRoot);
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"));
    const current = emptyAutonomyIssueProjection();
    const next = applyAutonomyIssueObservations({
      current,
      observations: [observation({
        runId: "run-1",
        observedAt: "2026-06-17T12:00:00.000Z",
      })],
    }).projection;
    expect(stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 0,
      current,
      next,
    })).toBe(true);
    expect(stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 1,
      current: next,
      next: structuredClone(next),
    })).toBe(false);
    expect(() => stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 0,
      current,
      next,
    })).toThrow(StateValueConflictError);
    expect(readAutonomyIssueProjection(state.stateDir, state.stateDir)).toEqual(next);
    expect(state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    )).toEqual({ revision: 1, value: next });
  });

  it("reads only the selected canonical scope and leaves obsolete mirrors untouched", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-issue-reader-"));
    scopeRoots.push(root);
    const stateDir = join(root, "daemon-state");
    const scopeA = join(root, "scope-a");
    const scopeB = join(root, "scope-b");
    const projection = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [observation({ runId: "canonical", observedAt: "2026-06-17T12:00:00.000Z" })],
    }).projection;
    const database = new RunStateDatabase(stateDir);
    try {
      for (const [id, rootPath] of [["a", scopeA], ["b", scopeB]] as const) {
        database.registerScope({ id, rootPath, createdAt: "2026-06-17T12:00:00.000Z" });
      }
      database.compareAndSetScopeStateValue({
        scopeId: "a",
        key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        expectedRevision: 0,
        value: projection,
        updatedAt: "2026-06-17T12:00:00.000Z",
      });
    } finally {
      database.close();
    }
    const mirrorDir = join(scopeA, ".kota", "autonomy-issues");
    mkdirSync(mirrorDir, { recursive: true });
    const mirrorPath = join(mirrorDir, "projection.json");
    writeFileSync(mirrorPath, "obsolete mirror is not valid JSON");
    expect(readAutonomyIssueProjection(scopeA, stateDir)).toEqual(projection);
    expect(readAutonomyIssueProjection(scopeB, stateDir)).toEqual(emptyAutonomyIssueProjection());
    expect(readAutonomyIssueProjection(join(root, "unknown"), stateDir)).toEqual(emptyAutonomyIssueProjection());
    expect(readAutonomyIssueProjection(scopeA, join(root, "missing-state"))).toEqual(emptyAutonomyIssueProjection());
    expect(existsSync(join(root, "missing-state"))).toBe(false);
    expect(readFileSync(mirrorPath, "utf-8")).toBe("obsolete mirror is not valid JSON");
  });

  it("rejects an outdated database without migrating it during inspection", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-issue-reader-schema-"));
    scopeRoots.push(root);
    const path = join(root, "kota.sqlite");
    const database = new Database(path);
    database.pragma("user_version = 0");
    database.close();
    const before = readFileSync(path);
    expect(() => readAutonomyIssueProjection(root, root)).toThrow(/daemon-owned migration/);
    expect(readFileSync(path)).toEqual(before);
  });
});
