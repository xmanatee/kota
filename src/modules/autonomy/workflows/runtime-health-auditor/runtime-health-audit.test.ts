import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectRuntimeHealthAuditForScope,
  makeRuntimeHealthAuditScopeRoot,
  RUNTIME_HEALTH_AUDIT_NOW,
  reviewAndApplyRuntimeHealthAudit,
  runtimeHealthReadyTaskFiles,
  staleWorkflowDispatchDeadLetter,
  writeRuntimeHealthDeadLetterQueue,
  writeRuntimeHealthModuleLog,
} from "./runtime-health-audit-test-context.js";

describe("runtime health audit", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeRuntimeHealthAuditScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("routes Telegram getUpdates conflicts to one issue decision", () => {
    writeRuntimeHealthModuleLog(workspaceRoot, "telegram", [
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

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot,
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

    const first = reviewAndApplyRuntimeHealthAudit(workspaceRoot, audit);
    const second = reviewAndApplyRuntimeHealthAudit(workspaceRoot, audit);

    expect(first.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "module:telegram:getupdates-conflict",
        transition: "opened",
      }),
    ]);
    expect(second.applied).toEqual([]);
    expect(runtimeHealthReadyTaskFiles(workspaceRoot)).toEqual([]);
  });

  it("requests one issue decision for stale open DLQ items", () => {
    writeRuntimeHealthDeadLetterQueue(workspaceRoot, [staleWorkflowDispatchDeadLetter()]);

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, staleDeadLetterMs: 60 * 60 * 1000 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "dead-letter:validation:workflow-runtime:builder",
        category: "local-code",
        actionability: "local-code",
      }),
    ]);

    const actions = reviewAndApplyRuntimeHealthAudit(workspaceRoot, audit);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "dead-letter:validation:workflow-runtime:builder",
      }),
    ]);
    expect(runtimeHealthReadyTaskFiles(workspaceRoot)).toEqual([]);
  });

  it("keeps classified agent transport DLQs separate from local execution repairs", () => {
    writeRuntimeHealthDeadLetterQueue(workspaceRoot, [
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
          'Repair loop for step "build" made no progress after 3 consecutive attempts. Still failing: task-queue-valid',
      }),
    ]);

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot,
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

    const actions = reviewAndApplyRuntimeHealthAudit(workspaceRoot, audit);
    expect(actions.applied).toEqual(
      [
        expect.objectContaining({
          kind: "decision-requested",
          dedupeKey: "dead-letter:execution:workflow-runtime:builder",
        }),
      ],
    );
    expect(runtimeHealthReadyTaskFiles(workspaceRoot)).toEqual([]);
  });

  it("does not infer issue disposition from a title-related active task", () => {
    writeRuntimeHealthDeadLetterQueue(workspaceRoot, [
      staleWorkflowDispatchDeadLetter({
        id: "dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7",
        workflow: "progress-reviewer",
        lastErrorClass: "execution",
        reason:
          'Agent step "review-evidence" (progress-reviewer) wrote tracked files outside its declared writeScope [.kota/runs/].',
        updatedAt: "2026-06-17T08:00:00.000Z",
      }),
    ]);
    const readyDir = join(workspaceRoot, "data", "tasks");
    mkdirSync(readyDir, { recursive: true });
    writeFileSync(
      join(readyDir, "task-clear-stale-progress-reviewer-write-scope-dlq-item.md"),
      [
        "---",
        "status: open",
        "priority: p3",
        "---",
        "",
        "# Clear stale progress-reviewer write-scope DLQ item",
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

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot,
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

    const actions = reviewAndApplyRuntimeHealthAudit(workspaceRoot, audit);

    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey:
          "dead-letter:execution:workflow-runtime:progress-reviewer",
      }),
    ]);
    expect(runtimeHealthReadyTaskFiles(workspaceRoot)).toEqual([
      "task-clear-stale-progress-reviewer-write-scope-dlq-item.md",
    ]);
  });

});
