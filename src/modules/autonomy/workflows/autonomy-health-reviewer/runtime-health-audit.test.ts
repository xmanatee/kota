import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import {
  DAEMON_STOP_ATTEMPTS_RELATIVE_PATH,
  recordDaemonStopAttempt,
} from "#modules/daemon-ops/daemon-ops-operations.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

const NOW = "2026-06-19T12:00:00.000Z";

describe("runtime health audit", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function reviewAndApply(audit: ReturnType<typeof collectRuntimeHealthAudit>) {
    const review = buildAutonomyHealthReviewFromSignals({
      signals: audit.signals,
      generatedAt: NOW,
      sourceEventName: "autonomy.runtime-health.audit",
      reason: "test",
    });
    return applyAutonomyHealthReviewActions({
      projectDir,
      runId: "runtime-health-test",
      review,
      nowIso: NOW,
    });
  }

  function writeModuleLog(moduleName: string, lines: string[]): void {
    const dir = join(projectDir, ".kota", "modules", moduleName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "logs.jsonl"), `${lines.join("\n")}\n`, "utf-8");
  }

  function readyTaskFiles(): string[] {
    const dir = join(projectDir, "data", "tasks", "ready");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.endsWith(".md"));
  }

  function staleWorkflowDispatchDeadLetter(
    overrides: {
      id?: string;
      workflow?: string;
      reason?: string;
      lastErrorClass?: DeadLetterItem["failure"]["lastErrorClass"];
      updatedAt?: string;
    } = {},
  ): DeadLetterItem {
    const id = overrides.id ?? "dlq-stale-1";
    const workflow = overrides.workflow ?? "builder";
    const updatedAt = overrides.updatedAt ?? "2026-06-17T08:00:00.000Z";
    return {
      id,
      type: "workflow-dispatch",
      status: "open",
      scopeId: "scope-a",
      projectId: "scope-a",
      owningModule: "workflow-runtime",
      sourceEventIds: ["evt-1"],
      affectedWorkflowNames: [workflow],
      failure: {
        reason:
          overrides.reason ?? "Payload failed validation for workflow dispatch",
        retryCount: 2,
        lastErrorClass: overrides.lastErrorClass ?? "validation",
        firstFailedAt: updatedAt,
        lastFailedAt: updatedAt,
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: workflow,
        triggerEvent: "autonomy.queue.available",
        triggerSchemaRef: null,
        failedRunId: `run-${workflow}-failed`,
        runDir: `.kota/runs/run-${workflow}-failed`,
      },
      redrive: {
        kind: "workflow",
        workflowName: workflow,
        source: { kind: "run-trigger", runId: `run-${workflow}-failed` },
      },
      redactedProjection: {},
      createdAt: updatedAt,
      updatedAt,
      redriveAttempts: [],
      retention: { kind: "retain" },
    };
  }

  function writeDeadLetterQueue(items: DeadLetterItem[]): void {
    mkdirSync(join(projectDir, ".kota", "dead-letter-queue"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "dead-letter-queue", "items.json"),
      JSON.stringify({ items }, null, 2),
      "utf-8",
    );
  }

  function writeInterruptedRun(args: {
    id: string;
    workflow: string;
    startedAt: string;
    error?: string;
  }): void {
    const runDir = join(projectDir, ".kota", "runs", args.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(
        {
          id: args.id,
          workflow: args.workflow,
          status: "interrupted",
          startedAt: args.startedAt,
          completedAt: args.startedAt,
          durationMs: 1000,
          steps: [],
        },
        null,
        2,
      ),
      "utf-8",
    );
    if (args.error) {
      writeFileSync(join(runDir, "error.txt"), args.error, "utf-8");
    }
  }

  it("routes Telegram getUpdates conflicts to one duplicate-consumer owner outcome", () => {
    writeModuleLog("telegram", [
      JSON.stringify({
        level: "warn",
        message:
          "Telegram getUpdates conflict: terminated by other getUpdates request",
      }),
      JSON.stringify({
        level: "warn",
        message: "409 Conflict from getUpdates polling",
      }),
    ]);

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "module:telegram:getupdates-conflict",
        category: "duplicate-consumer",
        actionability: "owner-action",
        labels: expect.arrayContaining(["duplicate-consumer", "operator-action"]),
        observationCount: 2,
      }),
    ]);

    const first = reviewAndApply(audit);
    const second = reviewAndApply(audit);

    expect(first.createdTaskIds).toEqual([]);
    expect(first.ownerQuestionIds).toHaveLength(1);
    expect(second.applied).toEqual([
      expect.objectContaining({
        kind: "skipped-owner-question",
        dedupeKey: "module:telegram:getupdates-conflict",
      }),
    ]);
    expect(readyTaskFiles()).toEqual([]);
  });

  it("creates one consolidated local repair task for stale open DLQ items", () => {
    writeDeadLetterQueue([staleWorkflowDispatchDeadLetter()]);

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "dead-letter:validation:workflow-runtime:builder",
        category: "local-code",
        actionability: "local-code",
      }),
    ]);

    const actions = reviewAndApply(audit);
    expect(actions.createdTaskIds).toEqual([
      "task-health-dead-letter-validation-workflow-runtime-builder",
    ]);
    const taskPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      "task-health-dead-letter-validation-workflow-runtime-builder.md",
    );
    const task = readFileSync(taskPath, "utf-8");
    expect(task).toContain(".kota/dead-letter-queue/items.json#dlq-stale-1");
    expect(task).toContain("Payload failed validation for workflow dispatch");
  });

  it("does not create a duplicate repair task when active work tracks stale DLQ evidence", () => {
    writeDeadLetterQueue([
      staleWorkflowDispatchDeadLetter({
        id: "dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7",
        workflow: "progress-reviewer",
        lastErrorClass: "execution",
        reason:
          'Agent step "review-evidence" (progress-reviewer) wrote tracked files outside its declared writeScope [.kota/runs/].',
        updatedAt: "2026-06-17T08:00:00.000Z",
      }),
    ]);
    const readyDir = join(projectDir, "data", "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    writeFileSync(
      join(readyDir, "task-clear-stale-progress-reviewer-write-scope-dlq-item.md"),
      [
        "---",
        "id: task-clear-stale-progress-reviewer-write-scope-dlq-item",
        "title: Clear stale progress-reviewer write-scope DLQ item",
        "status: ready",
        "priority: p3",
        "area: platform",
        "summary: Existing active work tracks the stale DLQ item.",
        `created_at: ${NOW}`,
        `updated_at: ${NOW}`,
        "---",
        "",
        "## Problem",
        "",
        "dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7 remains open after the root-cause repair.",
        "",
        "Evidence ids:",
        "",
        "- scope:scope-a:dead-letter:dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7",
      ].join("\n"),
      "utf-8",
    );

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey:
          "dead-letter:execution:workflow-runtime:progress-reviewer",
        category: "local-code",
        actionability: "local-code",
      }),
    ]);

    const actions = reviewAndApply(audit);

    expect(actions.createdTaskIds).toEqual([]);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "skipped-task",
        taskId: "task-clear-stale-progress-reviewer-write-scope-dlq-item",
        dedupeKey:
          "dead-letter:execution:workflow-runtime:progress-reviewer",
        reason: expect.stringContaining("already tracks this evidence"),
      }),
    ]);
    expect(readyTaskFiles()).toEqual([
      "task-clear-stale-progress-reviewer-write-scope-dlq-item.md",
    ]);
  });

  it("creates one root-cause repair task for repeated interrupted runs", () => {
    for (const [id, startedAt] of [
      ["run-a", "2026-06-19T10:00:00.000Z"],
      ["run-b", "2026-06-19T11:00:00.000Z"],
    ] as const) {
      writeInterruptedRun({ id, workflow: "builder", startedAt });
    }

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "workflow:builder:interrupted-run",
        category: "local-code",
        observationCount: 2,
      }),
    ]);

    const first = reviewAndApply(audit);
    const second = reviewAndApply(audit);

    expect(first.createdTaskIds).toEqual([
      "task-health-workflow-builder-interrupted-run",
    ]);
    expect(second.applied).toEqual([
      expect.objectContaining({
        kind: "skipped-task",
        taskId: "task-health-workflow-builder-interrupted-run",
        reason: expect.stringContaining("already records this evidence"),
      }),
    ]);
  });

  it("routes known runtime abort interruptions outside local repair tasks", () => {
    writeInterruptedRun({
      id: "improver-abort-a",
      workflow: "improver",
      startedAt: "2026-06-17T16:38:32.184Z",
      error: 'Agent step "improve" failed (aborted): Codex CLI run aborted.',
    });
    writeInterruptedRun({
      id: "improver-abort-b",
      workflow: "improver",
      startedAt: "2026-06-17T16:52:59.769Z",
      error: 'Agent step "improve" failed (aborted): Codex CLI run aborted.',
    });
    writeInterruptedRun({
      id: "improver-restart",
      workflow: "improver",
      startedAt: "2026-06-15T23:44:08.673Z",
      error: "Interrupted: daemon restarted while run was in progress.",
    });

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "workflow:improver:interrupted-run:harness-abort",
        category: "operator-action",
        actionability: "owner-action",
        labels: expect.arrayContaining([
          "harness-abort",
          "improver",
          "interrupted-run",
          "operator-action",
        ]),
        observationCount: 2,
        evidenceRefs: expect.arrayContaining([
          expect.objectContaining({
            kind: "artifact",
            ref: ".kota/runs/improver-abort-a/error.txt",
            summary:
              'Agent step "improve" failed (aborted): Codex CLI run aborted.',
          }),
        ]),
      }),
    ]);
    expect(audit.patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "workflow:improver:interrupted-run",
        }),
      ]),
    );

    const actions = reviewAndApply(audit);

    expect(actions.createdTaskIds).toEqual([]);
    expect(actions.ownerQuestionIds).toHaveLength(1);
    expect(readyTaskFiles()).toEqual([]);
  });

  it("reads status-derived operator runtime warnings from daemon control evidence", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "daemon-control.json"),
      JSON.stringify(
        {
          port: 8765,
          pid: Number.MAX_SAFE_INTEGER,
          startedAt: "2026-06-19T10:00:00.000Z",
          token: "test-token",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW },
    });

    expect(audit.inspected.operatorRuntimeWarnings).toBeGreaterThanOrEqual(1);
    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "operator-inbox:runtime:daemon-control-stale",
          category: "operator-action",
          actionability: "owner-action",
          evidenceRefs: [
            expect.objectContaining({
              kind: "artifact",
              ref: join(".kota", "daemon-control.json"),
            }),
          ],
        }),
      ]),
    );
  });

  it("reads daemon stop timeout evidence recorded by daemon-ops", () => {
    recordDaemonStopAttempt({
      projectDir,
      attemptedAt: "2026-06-19T11:00:00.000Z",
      timeoutSec: 3,
      result: { ok: false, reason: "timeout", pid: 12345 },
    });

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW },
    });

    expect(audit.inspected.daemonStopAttempts).toBe(1);
    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "daemon:shutdown-timeout",
        category: "local-code",
        actionability: "local-code",
        evidenceRefs: [
          expect.objectContaining({
            kind: "artifact",
            ref: `${DAEMON_STOP_ATTEMPTS_RELATIVE_PATH}#L1`,
          }),
        ],
      }),
    ]);

    const actions = reviewAndApply(audit);
    expect(actions.createdTaskIds).toEqual([
      "task-health-daemon-shutdown-timeout",
    ]);
  });

  it("keeps noisy external provider failures out of local repair tasks", () => {
    writeModuleLog("email", [
      JSON.stringify({ message: "SMTP provider network timeout" }),
      JSON.stringify({ message: "SMTP provider ECONNRESET while sending" }),
      JSON.stringify({ message: "SMTP provider network timeout" }),
    ]);

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "module:email:external-provider-failure",
        category: "external-service/auth",
        actionability: "external-service",
      }),
    ]);

    const actions = reviewAndApply(audit);
    expect(actions.createdTaskIds).toEqual([]);
    expect(readyTaskFiles()).toEqual([]);
  });
});
