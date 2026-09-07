import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedIssueDrivenLoopFixture,
  waitUntil,
} from "./autonomous-loop.integration-test-helpers.js";
import { autonomyIssueDecisionRequested } from "./autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  readAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import { makeAutonomyIssueSourceContext } from "./autonomy-issue-sources.test-helpers.js";
import { createTestWorkflowRuntime } from "./autonomy-runtime.test-helpers.js";
import { autonomyHealthSignal, normalizeHealthSignal } from "./health-signal.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);
const FIRST_SEEN = "2026-09-01T20:00:00.000Z";

describe("autonomy issue restart reconciliation", () => {
  const roots: string[] = [];

  afterEach(() => {
    mockedExecuteWithAgentSDK.mockReset();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("durably queues reconciliation when cancellation releases the current investigation", () => {
    const workspaceRoot = join(
      tmpdir(),
      `kota-issue-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    roots.push(workspaceRoot);
    seedIssueDrivenLoopFixture(workspaceRoot);
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const bus = new EventBus();
    const source = makeAutonomyIssueSourceContext(workspaceRoot, bus, scopeId);
    const enqueuePendingRun = vi.spyOn(
      source.runtime.workflowRuntime,
      "enqueuePendingRun",
    ).mockReturnValue({ ok: true, queued: "improver", runId: "retry-run" });
    const cancelledAt = "2026-09-03T10:00:00.000Z";
    const projection = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [buildAutonomyIssueObservation({
        kind: "present",
        rootCauseKey: "module:telegram:getupdates-conflict",
        observedAt: cancelledAt,
        signalIds: ["health-telegram-cancelled"],
        source: { kind: "module", id: "telegram", module: "telegram" },
        severity: "error",
        actionability: "local-code",
        labels: ["module-failure", "telegram"],
        summaries: ["Telegram channel operation failed."],
        evidenceRefs: [{
          kind: "module-log",
          ref: ".kota/modules/telegram/logs.jsonl",
        }],
        observationCount: 1,
      })],
    }).projection;
    const issue = projection.issues[0]!;
    source.runtime.runState.compareAndSetScopeStateValue({
      scopeId,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      expectedRevision: 0,
      value: projection,
      updatedAt: cancelledAt,
    });
    source.runtime.runState.admitRun({
      id: "cancelled-improver",
      scopeId,
      workflow: "improver",
      trigger: {
        event: autonomyIssueDecisionRequested.name,
        schemaRef: null,
        payload: {
          issueKey: issue.issueKey,
          semanticRevision: issue.semanticRevision,
        },
      },
      repository: "write",
      resources: [],
      admittedAt: cancelledAt,
    });
    source.runtime.runState.cancelQueuedRun("cancelled-improver", cancelledAt);
    subscribeAutonomyIssueSources(source.ctx);

    bus.emit("workflow.run.reconciliation-needed", {
      scopeId,
      workflow: "improver",
      runId: "cancelled-improver",
      state: "cancelled",
      transitionedAt: "2026-09-03T10:01:00.000Z",
    });

    expect(enqueuePendingRun).toHaveBeenCalledWith("improver", {
      event: autonomyIssueDecisionRequested.name,
      payload: expect.objectContaining({
        scopeId,
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        requestKind: "reconciliation",
      }),
      runId: expect.stringContaining("improver"),
      notBeforeMs: Date.parse("2026-09-03T10:05:00.000Z"),
    });
    source.runtime.runState.close();
  });

  it("persists a future-eligible retry owner during investigation backoff", async () => {
    const workspaceRoot = join(
      tmpdir(),
      `kota-issue-backoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    roots.push(workspaceRoot);
    seedIssueDrivenLoopFixture(workspaceRoot);
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const failedAt = new Date(Date.now() - 1_000).toISOString();
    const projection = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [buildAutonomyIssueObservation({
        kind: "present",
        rootCauseKey: "module:telegram:getupdates-conflict",
        observedAt: failedAt,
        signalIds: ["health-telegram-backoff"],
        source: { kind: "module", id: "telegram", module: "telegram" },
        severity: "error",
        actionability: "local-code",
        labels: ["module-failure", "telegram"],
        summaries: ["Telegram channel operation failed."],
        evidenceRefs: [{
          kind: "module-log",
          ref: ".kota/modules/telegram/logs.jsonl",
        }],
        observationCount: 1,
      })],
    }).projection;
    const issue = projection.issues[0]!;
    const stateDir = join(workspaceRoot, ".kota", "state");
    const seedState = new RunStateDatabase(stateDir);
    seedState.registerScope({
      id: scopeId,
      rootPath: workspaceRoot,
      createdAt: failedAt,
    });
    const epoch = seedState.beginDaemonSession(failedAt).epoch;
    seedState.compareAndSetScopeStateValue({
      scopeId,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      expectedRevision: 0,
      value: projection,
      updatedAt: failedAt,
    });
    seedState.admitRun({
      id: "improver-failed-before-restart",
      scopeId,
      workflow: "improver",
      trigger: {
        event: autonomyIssueDecisionRequested.name,
        schemaRef: null,
        payload: {
          issueKey: issue.issueKey,
          semanticRevision: issue.semanticRevision,
        },
      },
      repository: "write",
      resources: [],
      admittedAt: failedAt,
    });
    seedState.startRun("improver-failed-before-restart", epoch, failedAt);
    seedState.finishRun(
      "improver-failed-before-restart",
      epoch,
      "failed",
      failedAt,
      "provider transport failed",
    );
    seedState.close();

    const bus = new EventBus();
    const pbus = new ScopedEventBus(bus, scopeId);
    const workflows = (await loadAutonomyWorkflowDefinitions()).filter(
      (workflow) => workflow.name === "improver",
    );
    const runtime = createTestWorkflowRuntime({
      bus,
      pbus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows,
    });
    const source = makeAutonomyIssueSourceContext(
      workspaceRoot,
      bus,
      scopeId,
      {
        runState: runtime.runState,
        workflowRuntime: runtime.runtime,
      },
    );
    subscribeAutonomyIssueSources(source.ctx);

    runtime.runtime.start();
    try {
      await waitUntil(
        () => runtime.runState.listRuns(scopeId, ["queued"]).length === 1,
        "a durable delayed retry to be admitted",
      );
      const queued = runtime.runState.listRuns(scopeId, ["queued"])[0]!;
      expect(queued).toMatchObject({
        workflow: "improver",
        trigger: {
          event: autonomyIssueDecisionRequested.name,
          payload: {
            issueKey: issue.issueKey,
            semanticRevision: issue.semanticRevision,
            requestKind: "reconciliation",
          },
        },
      });
      expect(Date.parse(queued.notBeforeAt!)).toBeGreaterThan(Date.now());
    } finally {
      await runtime.stop();
      source.runtime.runState.close();
    }

    const persisted = RunStateDatabase.openReadOnly(stateDir);
    try {
      expect(persisted.listRuns(scopeId, ["queued"])).toEqual([
        expect.objectContaining({
          workflow: "improver",
          notBeforeAt: expect.any(String),
        }),
      ]);
    } finally {
      persisted.close();
    }
  });

  it(
    "re-admits an orphaned revision through production admission and publishes one durable repair",
    { timeout: 90_000 },
    async () => {
      const workspaceRoot = join(
        tmpdir(),
        `kota-issue-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      roots.push(workspaceRoot);
      seedIssueDrivenLoopFixture(workspaceRoot);
      const scopeId = deriveDirectoryScopeId(workspaceRoot);
      const observation = buildAutonomyIssueObservation({
        kind: "present",
        rootCauseKey: "module:telegram:getupdates-conflict",
        observedAt: FIRST_SEEN,
        signalIds: ["health-telegram-first"],
        source: { kind: "module-log", id: "telegram", module: "telegram" },
        severity: "error",
        actionability: "owner-action",
        labels: [
          "module-failure",
          "telegram",
          "operation/poll-loop",
          "duplicate-consumer",
          "external-service",
          "operator-action",
        ],
        summaries: ["Telegram poll loop reports a duplicate consumer."],
        evidenceRefs: [{
          kind: "module-log",
          ref: ".kota/modules/telegram/logs.jsonl",
        }],
        observationCount: 1,
      });
      const projection = applyAutonomyIssueObservations({
        current: emptyAutonomyIssueProjection(),
        observations: [observation],
      }).projection;
      const issue = projection.issues[0]!;

      const seedState = new RunStateDatabase(join(workspaceRoot, ".kota", "state"));
      seedState.registerScope({
        id: scopeId,
        rootPath: workspaceRoot,
        createdAt: FIRST_SEEN,
      });
      const epoch = seedState.beginDaemonSession(FIRST_SEEN).epoch;
      seedState.compareAndSetScopeStateValue({
        scopeId,
        key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        expectedRevision: 0,
        value: projection,
        updatedAt: FIRST_SEEN,
      });
      const failedRunId = "2026-09-01T20-18-58-775Z-improver-zxg0n9";
      seedState.admitRun({
        id: failedRunId,
        scopeId,
        workflow: "improver",
        trigger: {
          event: autonomyIssueDecisionRequested.name,
          schemaRef: null,
          payload: {
            issueKey: issue.issueKey,
            semanticRevision: issue.semanticRevision,
          },
        },
        repository: "write",
        resources: [],
        admittedAt: FIRST_SEEN,
      });
      seedState.startRun(failedRunId, epoch, FIRST_SEEN);
      seedState.finishRun(
        failedRunId,
        epoch,
        "failed",
        "2026-09-01T20:19:00.000Z",
        "provider transport failed",
      );
      seedState.close();

      const disposition = {
        action: "create-task",
        recoveryAction: "",
        rationale: "The duplicate consumer remains unresolved and needs one repair owner.",
        taskTitle: "Repair Telegram duplicate polling consumer",
        taskSummary: "Remove the duplicate Telegram polling owner.",
        taskPriority: "p0",
        taskHowWeWillKnow: "The poll loop emits a matching recovered observation.",
        ownerQuestion: "",
        ownerReason: "",
        proposedAnswers: [],
      } as const;
      mockedExecuteWithAgentSDK.mockResolvedValue({
        text: ["```json", JSON.stringify(disposition), "```"].join("\n"),
        streamedText: "",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        subtype: "success",
        isError: false,
      } as never);

      const bus = new EventBus();
      const pbus = new ScopedEventBus(bus, scopeId);
      const workflows = (await loadAutonomyWorkflowDefinitions()).filter((workflow) =>
        [
          "autonomy-health-reviewer",
          "autonomy-issue-projection-materialization",
          "improver",
          "improver-disposition-publication",
        ].includes(workflow.name)
      );
      const runtime = createTestWorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        pbus,
        scopeRoot: workspaceRoot,
        idleIntervalMs: 10,
        workflows,
      });
      const source = makeAutonomyIssueSourceContext(
        workspaceRoot,
        bus,
        scopeId,
        {
          runState: runtime.runState,
          workflowRuntime: runtime.runtime,
        },
      );
      subscribeAutonomyIssueSources(source.ctx);
      const completed: string[] = [];
      bus.on("workflow.completed", (payload) => completed.push(payload.workflow));

      runtime.runtime.start();
      try {
        for (const [index, observationCount] of [8, 8, 8, 8, 11].entries()) {
          pbus.emit(
            autonomyHealthSignal,
            normalizeHealthSignal({
              observation: "present",
              source: observation.source,
              severity: observation.severity,
              labels: observation.labels,
              summary: observation.summaries[0]!,
              evidenceRefs: observation.evidenceRefs,
              actionability: observation.actionability,
              dedupeKey: observation.rootCauseKey,
              observationCount,
              createdAt: `2026-09-03T09:0${index}:00.000Z`,
            }),
          );
        }
        await waitUntil(
          () => runtime.runState.readScopeStateValue<{
            issues: Array<{ occurrenceCount: number }>;
          }>(scopeId, AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value
            ?.issues[0]?.occurrenceCount === 44,
          "the repeated observation to enrich the same revision",
          45_000,
        );

        await waitUntil(
          () => completed.includes("improver-disposition-publication"),
          "the reconciled disposition publication",
          45_000,
        );
        await waitUntil(
          () => readAutonomyIssueProjection(workspaceRoot).issues[0]
            ?.links.taskIds.length === 1,
          "the materialized issue owner",
          45_000,
        );

        expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
        expect(listFullRepoTasks(workspaceRoot)).toEqual([
          expect.objectContaining({ state: "open" }),
        ]);
        expect(readAutonomyIssueProjection(workspaceRoot).issues[0]).toMatchObject({
          semanticRevision: 1,
          occurrenceCount: 44,
          status: "open",
          disposition: { kind: "task", semanticRevision: 1 },
          links: { taskIds: [listFullRepoTasks(workspaceRoot)[0]!.id] },
        });
      } finally {
        await runtime.stop();
        source.runtime.runState.close();
      }
    },
  );
});
