import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { buildAutonomyIssueObservation, emptyAutonomyIssueProjection, readAutonomyIssueProjection, reduceAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { seedAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.test-helpers.js";
import { buildAutonomyHealthBreakdown } from "#modules/autonomy/report/aggregate-health.js";
import {
  collectRuntimeHealthAuditForScope,
  reviewAndApplyRuntimeHealthAudit,
  writeRuntimeHealthModuleLog,
} from "#modules/autonomy/workflows/runtime-health-auditor/runtime-health-audit-test-context.js";

// Detects loss of recovery chronology between persisted module logs, scheduled
// audits, health review, SQLite issue state and the operator health projection.
const fixture = JSON.parse(readFileSync(new URL(
  "./modules/autonomy/workflows/runtime-health-auditor/telegram-health-chronology.fixture.json", import.meta.url,
), "utf8")) as { records: Array<{ ts: string; level: string; module: string; msg: string; data?: { operation: string } }> };
const polling = fixture.records.filter((row) => row.data?.operation === "poll-loop");
const sending = fixture.records.filter((row) => !row.data);
const failures = polling.filter((row) => row.level === "error");
const recovery = polling.find((row) => row.level === "info")!;

describe("module operation health replay", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-module-health-replay-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function audit(records: typeof polling, nowIso = "2026-09-14T18:11:37.000Z") {
    writeRuntimeHealthModuleLog(root, "telegram", records.map((row) => JSON.stringify(row)));
    return collectRuntimeHealthAuditForScope({ workspaceRoot: root, options: { nowIso } });
  }
  function issue() { return readAutonomyIssueProjection(root, join(root, ".kota")).issues[0]!; }

  it("persists a recovery-only audit before older failures arrive after restart", () => {
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([recovery])).applied).toEqual([]);
    expect(readAutonomyIssueProjection(root, join(root, ".kota")).issues).toEqual([]);
    const backfill = reviewAndApplyRuntimeHealthAudit(root, audit(failures));
    expect(backfill.applied.every((action) => action.kind !== "decision-requested")).toBe(true);
    expect(issue().status).toBe("resolved");
    const revision = issue().semanticRevision;
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(failures)).applied).toEqual([]);
    const later = { ...failures[0]!, ts: "2026-09-14T17:00:00Z" };
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([later])).applied).toMatchObject([{ transition: "reopened" }]);
    expect(issue()).toMatchObject({ status: "needs-decision", semanticRevision: revision + 1 });
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([recovery])).applied).toEqual([]);
    expect(issue().status).toBe("needs-decision");
  });

  it.each(["persisted", "same-batch"] as const)("admits a single later failure with %s recovery evidence", (mode) => {
    if (mode === "persisted") reviewAndApplyRuntimeHealthAudit(root, audit([recovery]));
    const later = { ...failures[0]!, ts: "2026-09-14T17:00:00Z" };
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(mode === "persisted" ? [later] : [recovery, later])).applied).toMatchObject([{ transition: "opened" }]);
    expect(issue().status).toBe("needs-decision");
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(failures)).applied).toEqual([]);
    expect(issue().lastSeenAt).toBe("2026-09-14T17:00:00.000Z");
  });

  it("reconciles persisted audit-time observations with cited occurrences without losing lineage", () => {
    const failed = audit(failures);
    const signal = failed.signals.find((item) => item.observation === "present")!;
    const legacy = buildAutonomyIssueObservation({
      kind: "present", rootCauseKey: signal.dedupeKey,
      observedAt: "2026-09-14T18:11:37.000Z", signalIds: ["old-audit"],
      source: signal.source, severity: signal.severity, actionability: signal.actionability,
      labels: signal.labels, summaries: ["Historical scheduled audit"],
      evidenceRefs: signal.evidenceRefs.map(({ kind, ref }) => ({ kind, ref })),
      observationCount: signal.observationCount,
    });
    const projection = reduceAutonomyIssueProjection(emptyAutonomyIssueProjection(), [legacy]).projection;
    projection.issues[0]!.links.taskIds = ["existing-task"];
    seedAutonomyIssueProjection(root, join(root, ".kota"), projection);
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(polling)).applied).toMatchObject([{ transition: "cleared" }]);
    expect(issue()).toMatchObject({
      issueKey: legacy.issueKey, status: "resolved", lastSeenAt: "2026-09-14T14:32:39.704Z",
      links: { taskIds: ["existing-task"] },
    });
    expect(issue().history[0]).toEqual(projection.issues[0]!.history[0]);
    const later = { ...failures[0]!, ts: "2026-09-14T17:00:00Z" };
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([later])).applied).toMatchObject([{ transition: "reopened" }]);
    expect(issue()).toMatchObject({ issueKey: legacy.issueKey, status: "needs-decision", lastSeenAt: "2026-09-14T17:00:00.000Z" });
    expect(reviewAndApplyRuntimeHealthAudit(root, failed).applied).toEqual([]);
  });

  it.each(["legacy", "explicit"] as const)("preserves unresolved %s deliveries through absent, partial and complete legacy attribution", (deliveryKind) => {
    const deliveries = deliveryKind === "explicit"
      ? sending.map((row) => ({ ...row, data: { operation: "send" } })) : sending;
    const signals = audit([...failures, ...deliveries]).signals.filter((signal) => signal.observation === "present");
    const first = signals[0]!;
    const legacy = buildAutonomyIssueObservation({
      kind: "present", rootCauseKey: first.dedupeKey,
      observedAt: "2026-09-14T14:33:00.000Z", signalIds: ["mixed-old-audit"],
      source: first.source, severity: first.severity, actionability: first.actionability,
      // Old aggregates could retain just their first pattern's operation label.
      labels: first.labels, summaries: ["Polling and delivery failures"],
      evidenceRefs: signals.flatMap((signal) => signal.evidenceRefs.map(({ kind, ref }) => ({ kind, ref }))),
      observationCount: signals.reduce((sum, signal) => sum + signal.observationCount, 0),
    });
    const projection = reduceAutonomyIssueProjection(emptyAutonomyIssueProjection(), [legacy]).projection;
    projection.issues[0]!.links.taskIds = ["existing-task"];
    projection.issues[0]!.links.ownerQuestionIds = ["existing-question"];
    seedAutonomyIssueProjection(root, join(root, ".kota"), projection);
    for (const cohort of [[recovery], [recovery], polling, [...polling, deliveries[0]!], [recovery], polling, [...polling, ...deliveries]]) {
      const result = reviewAndApplyRuntimeHealthAudit(root, audit(cohort));
      expect(result.applied).toEqual([]);
      expect(result.taskMutations).toEqual([]);
      expect(result.ownerQuestionDismissals).toEqual([]);
      expect(issue()).toMatchObject({
        issueKey: legacy.issueKey, status: "needs-decision", semanticRevision: 1,
        links: { taskIds: ["existing-task"], ownerQuestionIds: ["existing-question"] },
      });
      expect(issue().history[0]).toEqual(projection.issues[0]!.history[0]);
      expect(issue().evidenceRefs).toEqual(expect.arrayContaining(legacy.evidenceRefs.map((ref) => expect.objectContaining(ref))));
    }
    expect(buildAutonomyHealthBreakdown(root, join(root, ".kota")).topGroups[0]).toMatchObject({ status: "needs-decision" });
    if (deliveryKind === "explicit") {
      const delivered = { ...recovery, ts: "2026-09-14T17:00:00Z",
        data: { operation: "send", health: "recovered" }, msg: "delivery recovered" };
      expect(reviewAndApplyRuntimeHealthAudit(root, audit([delivered])).applied).toMatchObject([{ transition: "cleared" }]);
      expect(issue().status).toBe("resolved");
      expect(reviewAndApplyRuntimeHealthAudit(root, audit([...failures, ...deliveries])).applied).toEqual([]);
    }
  });

  it.each(["uncited", "cited"] as const)("uses actual recovery time after reconciling a %s legacy clear", (citation) => {
    const failed = audit(failures).signals.find((signal) => signal.observation === "present")!;
    const recoverySignal = audit([recovery]).signals[0]!;
    const legacy = buildAutonomyIssueObservation({
      kind: "cleared", rootCauseKey: failed.dedupeKey,
      observedAt: "2026-09-14T15:33:29.000Z", signalIds: ["legacy-clear"],
      source: failed.source, severity: failed.severity, actionability: failed.actionability,
      labels: failed.labels, summaries: ["Legacy recovery review"],
      evidenceRefs: citation === "cited" ? recoverySignal.evidenceRefs.map(({ kind, ref }) => ({ kind, ref })) : [],
      observationCount: 1,
    });
    const projection = reduceAutonomyIssueProjection(emptyAutonomyIssueProjection(), [legacy]).projection;
    seedAutonomyIssueProjection(root, join(root, ".kota"), projection);
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([recovery])).applied).toEqual([]);
    expect(issue()).toMatchObject({ status: "resolved", disposition: { updatedAt: "2026-09-14T14:33:29.102Z" } });
    const later = { ...failures[0]!, ts: "2026-09-14T15:00:00Z" };
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([later])).applied).toMatchObject([{ transition: "reopened" }]);
    expect(issue()).toMatchObject({ issueKey: legacy.issueKey, status: "needs-decision", semanticRevision: 1 });
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(polling)).applied).toEqual([]);
    expect(issue().status).toBe("needs-decision");
    expect(issue().history[0]).toEqual(projection.issues[0]!.history[0]);
  });

  it("keeps recovered exported episodes resolved through audits, restart, backfill and later recurrence", () => {
    const failed = audit(failures);
    expect(reviewAndApplyRuntimeHealthAudit(root, failed).applied).toMatchObject([{ transition: "opened" }]);
    const key = issue().issueKey;
    expect(issue().lastSeenAt).toBe("2026-09-14T14:32:39.704Z");
    expect(issue().firstSeenAt).toBe("2026-09-11T11:18:47.090Z");
    const recovered = audit(polling);
    expect(reviewAndApplyRuntimeHealthAudit(root, recovered).applied).toMatchObject([{ transition: "cleared" }]);
    expect(issue().disposition.updatedAt).toBe(recovery.ts);
    const revision = issue().semanticRevision;
    const count = issue().occurrenceCount;
    // Every helper call closes and reopens the actual SQLite owner.
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([...polling].reverse(), "2026-09-14T19:00:00Z")).applied).toEqual([]);
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(failures.slice(0, 2))).applied).toEqual([]);
    expect(reviewAndApplyRuntimeHealthAudit(root, failed).applied).toEqual([]);
    expect(issue()).toMatchObject({ issueKey: key, status: "resolved", semanticRevision: revision, occurrenceCount: count });
    expect(buildAutonomyHealthBreakdown(root, join(root, ".kota")).topGroups[0]).toMatchObject({ status: "resolved" });

    const later = { ...failures[0]!, ts: "2026-09-14T19:05:00Z" };
    const recurrence = reviewAndApplyRuntimeHealthAudit(root, audit([later], "2026-09-14T19:06:00Z"));
    expect(recurrence.applied).toMatchObject([{ transition: "reopened" }]);
    expect(issue()).toMatchObject({ issueKey: key, status: "needs-decision", semanticRevision: revision + 1 });
    expect(reviewAndApplyRuntimeHealthAudit(root, recovered).applied).toEqual([]);
    expect(issue().status).toBe("needs-decision");
  });

  it("discovers missed delivery failures without treating polling recovery as delivery recovery", () => {
    reviewAndApplyRuntimeHealthAudit(root, audit(polling));
    expect(issue().status).toBe("resolved");
    const result = reviewAndApplyRuntimeHealthAudit(root, audit([...polling, ...sending]));
    expect(result.applied).toMatchObject([{ transition: "reopened" }]);
    expect(issue().labels).toContain("operation/legacy-log");
    const revision = issue().semanticRevision;
    expect(reviewAndApplyRuntimeHealthAudit(root, audit(polling)).applied).toEqual([]);
    expect(issue()).toMatchObject({ status: "needs-decision", semanticRevision: revision });
    expect(buildAutonomyHealthBreakdown(root, join(root, ".kota")).topGroups[0]).toMatchObject({ status: "needs-decision" });
  });

  it("does not emit transient resolution actions for mixed operation evidence in one batch", () => {
    const result = reviewAndApplyRuntimeHealthAudit(root, audit([...polling, ...sending]));
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.kind).toBe("decision-requested");
    expect(result.taskMutations).toEqual([]);
    expect(result.ownerQuestionDismissals).toEqual([]);
    expect(issue().status).toBe("needs-decision");
  });

  it("preserves a pending question through a mixed recovery/backfill batch until all operations recover", () => {
    reviewAndApplyRuntimeHealthAudit(root, audit(failures));
    const projection = readAutonomyIssueProjection(root, join(root, ".kota"));
    const queue = new OwnerQuestionQueue(join(root, ".kota", "owner-questions"));
    const question = queue.enqueue({
      context: "Module provider failures", question: "Investigate the provider?",
      reason: "Unresolved incident", source: "fixture", answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
    });
    projection.issues[0]!.links.ownerQuestionIds = [question.id];
    seedAutonomyIssueProjection(root, join(root, ".kota"), projection);
    const deliveries = sending.map((row) => ({ ...row, data: { operation: "send" } }));
    const mixed = reviewAndApplyRuntimeHealthAudit(root, audit([...polling, ...deliveries]));
    expect(mixed.applied).toMatchObject([{ kind: "decision-requested" }]);
    expect(mixed.taskMutations).toEqual([]);
    expect(mixed.ownerQuestionDismissals).toEqual([]);
    expect(issue()).toMatchObject({ status: "needs-decision", links: { ownerQuestionIds: [question.id] } });
    expect(reviewAndApplyRuntimeHealthAudit(root, audit([...polling, ...deliveries])).applied).toEqual([]);
    expect(issue().links.ownerQuestionIds).toEqual([question.id]);
    const delivered = { ...recovery, ts: "2026-09-14T17:00:00Z",
      data: { operation: "send", health: "recovered" }, msg: "delivery recovered" };
    const cleared = reviewAndApplyRuntimeHealthAudit(root, audit([delivered]));
    expect(cleared.applied).toMatchObject([{ transition: "cleared" }]);
    expect(cleared.ownerQuestionDismissals).toMatchObject([{ questionId: question.id }]);
    expect(issue()).toMatchObject({ status: "resolved", links: { ownerQuestionIds: [] } });
  });

  it.each([false, true])("reconciles earlier backfill under an unchanged latest failure (recovered: %s)", (recovered) => {
    reviewAndApplyRuntimeHealthAudit(root, audit(failures.slice(1)));
    if (recovered) reviewAndApplyRuntimeHealthAudit(root, audit([recovery]));
    const before = issue();
    expect(before.occurrenceCount).toBe(2);
    expect(before.firstSeenAt).toBe("2026-09-11T12:42:15.955Z");
    for (const cohort of [failures, [...failures].reverse(), failures.slice(1)]) {
      const replay = reviewAndApplyRuntimeHealthAudit(root, audit(cohort));
      expect(replay.applied).toEqual([]);
      expect(replay.ownerQuestionDismissals).toEqual([]);
      expect(issue()).toMatchObject({
        issueKey: before.issueKey, status: before.status, semanticRevision: before.semanticRevision,
        occurrenceCount: 3, firstSeenAt: "2026-09-11T11:18:47.090Z", lastSeenAt: before.lastSeenAt,
      });
      expect(issue().history.map((entry) => entry.observationId)).toEqual(before.history.map((entry) => entry.observationId));
    }
  });

  it("counts distinct failure records across overlapping audits", () => {
    reviewAndApplyRuntimeHealthAudit(root, audit(failures.slice(0, 2)));
    expect(issue().occurrenceCount).toBe(2);
    reviewAndApplyRuntimeHealthAudit(root, audit(failures));
    expect(issue().occurrenceCount).toBe(3);
    reviewAndApplyRuntimeHealthAudit(root, audit([...failures].reverse()));
    reviewAndApplyRuntimeHealthAudit(root, audit(failures.slice(0, 2)));
    reviewAndApplyRuntimeHealthAudit(root, audit(polling));
    expect(issue()).toMatchObject({ status: "resolved", occurrenceCount: 3 });
  });

  it("reads explicit recovery from the production module logger without inferring success from prose", async () => {
    const loader = new ModuleLoader({}, false, { mode: "runtime", scopeRoot: root });
    loader.setCwd(root);
    loader.setBus(new EventBus());
    let context: ModuleContext | undefined;
    await loader.load({ name: "telegram", onLoad: (ctx) => { context = ctx; } });
    try {
      context!.log.operationFailed!(deriveDirectoryScopeId(root), "send", "network timeout");
      context!.log.operationFailed!(deriveDirectoryScopeId(root), "send", "network timeout again");
      context!.log.info("send recovered", { operation: "send" });
      const collect = () => collectRuntimeHealthAuditForScope({ workspaceRoot: root });
      expect(reviewAndApplyRuntimeHealthAudit(root, collect()).applied).toMatchObject([{ transition: "opened" }]);
      context!.log.operationRecovered!(deriveDirectoryScopeId(root), "poll-loop", "healthy");
      expect(reviewAndApplyRuntimeHealthAudit(root, collect()).applied).toEqual([]);
      expect(issue().status).toBe("needs-decision");
      context!.log.operationRecovered!(deriveDirectoryScopeId(root), "send", "healthy");
      expect(reviewAndApplyRuntimeHealthAudit(root, collect()).applied).toMatchObject([{ transition: "cleared" }]);
      expect(issue().status).toBe("resolved");
    } finally { await loader.unloadAll(); }
  });
});
