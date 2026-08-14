import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";
import {
  makeRuntimeHealthAuditProjectDir,
  RUNTIME_HEALTH_AUDIT_NOW,
  reviewAndApplyRuntimeHealthAudit,
  runtimeHealthReadyTaskFiles,
  staleWorkflowDispatchDeadLetter,
  writeRuntimeHealthDeadLetterQueue,
  writeRuntimeHealthModuleLog,
} from "./runtime-health-audit-test-context.js";

describe("runtime health audit", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeRuntimeHealthAuditProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("routes Telegram getUpdates conflicts to one issue decision", () => {
    writeRuntimeHealthModuleLog(projectDir, "telegram", [
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
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW },
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

    const first = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    const second = reviewAndApplyRuntimeHealthAudit(projectDir, audit);

    expect(first.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "module:telegram:getupdates-conflict",
        transition: "opened",
      }),
    ]);
    expect(second.applied).toEqual([]);
    expect(runtimeHealthReadyTaskFiles(projectDir)).toEqual([]);
  });

  it("requests one issue decision for stale open DLQ items", () => {
    writeRuntimeHealthDeadLetterQueue(projectDir, [staleWorkflowDispatchDeadLetter()]);

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "dead-letter:validation:workflow-runtime:builder",
        category: "local-code",
        actionability: "local-code",
      }),
    ]);

    const actions = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "dead-letter:validation:workflow-runtime:builder",
      }),
    ]);
    expect(runtimeHealthReadyTaskFiles(projectDir)).toEqual([]);
  });

  it("keeps classified agent transport DLQs separate from local execution repairs", () => {
    writeRuntimeHealthDeadLetterQueue(projectDir, [
      staleWorkflowDispatchDeadLetter({
        id: "dlq-provider-transport",
        lastErrorClass: "execution",
        reason:
          'Repair agent for step "build" failed: Reconnecting... 2/5 (stream disconnected before completion: idle timeout waiting for websocket)',
      }),
      staleWorkflowDispatchDeadLetter({
        id: "dlq-local-execution",
        lastErrorClass: "execution",
        reason:
          'Repair loop for step "build" made no progress after 3 consecutive attempts. Still failing: autonomy-change-decision',
      }),
    ]);

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "dead-letter:provider:workflow-runtime:builder",
          category: "external-service/auth",
          actionability: "external-service",
          labels: expect.arrayContaining([
            "dead-letter",
            "external-service",
            "provider",
          ]),
        }),
        expect.objectContaining({
          dedupeKey: "dead-letter:execution:workflow-runtime:builder",
          category: "local-code",
          actionability: "local-code",
          labels: expect.arrayContaining([
            "dead-letter",
            "execution",
            "local-code",
          ]),
        }),
      ]),
    );

    const actions = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    expect(actions.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decision-requested",
          dedupeKey: "dead-letter:execution:workflow-runtime:builder",
        }),
        expect.objectContaining({
          kind: "decision-requested",
          dedupeKey: "dead-letter:provider:workflow-runtime:builder",
        }),
      ]),
    );
    expect(runtimeHealthReadyTaskFiles(projectDir)).toEqual([]);
  });

  it("does not infer issue disposition from a title-related active task", () => {
    writeRuntimeHealthDeadLetterQueue(projectDir, [
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
        `created_at: ${RUNTIME_HEALTH_AUDIT_NOW}`,
        `updated_at: ${RUNTIME_HEALTH_AUDIT_NOW}`,
        "---",
        "",
        "<!-- autonomy-health-dedupe-key: dead-letter:execution:workflow-runtime:progress-reviewer -->",
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
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey:
          "dead-letter:execution:workflow-runtime:progress-reviewer",
        category: "local-code",
        actionability: "local-code",
      }),
    ]);

    const actions = reviewAndApplyRuntimeHealthAudit(projectDir, audit);

    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey:
          "dead-letter:execution:workflow-runtime:progress-reviewer",
      }),
    ]);
    expect(runtimeHealthReadyTaskFiles(projectDir)).toEqual([
      "task-clear-stale-progress-reviewer-write-scope-dlq-item.md",
    ]);
  });

});
