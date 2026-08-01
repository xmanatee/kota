import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { JsonFileError } from "#core/util/json-file.js";
import { clearAwaitFiles, writeSuspension } from "#core/workflow/awaits-store.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { beginApprovalExecutionActivity } from "./approval-execution-activity.js";
import { ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScopeDrainBlocker } from "./scope-drain-inspection.js";
import { ScopeLifecycleService } from "./scope-lifecycle.js";
import { mockPendingWorkflowBuffers } from "./scope-lifecycle-test-support.integration.js";
import { deriveDirectoryScopeId, ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

function projectDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `kota-scope-lifecycle-${name}-`));
}

describe("ScopeLifecycleService", () => {
  it("fails closed, reports every drain disposition, and leaves removal non-destructive", async () => {
    const scopeA = projectDir("a");
    const scopeB = projectDir("b");
    const stateDir = projectDir("state");
    const bus = new EventBus();
    const registry = new ScopeRegistry({ stateDir, projects: [{ projectDir: scopeA }] });
    const scopeAId = deriveDirectoryScopeId(scopeA);
    const runtimes = ProjectRuntimeRegistry.create({
      registry,
      bus,
      workflows: [
        registerWorkflowDefinition("test/pending-scope-work.ts", {
          name: "pending-scope-work",
          triggers: [{ event: "test.pending-scope-work" }],
          steps: [{ id: "noop", type: "code", run: () => "ok" }],
        }),
      ],
      idleIntervalMs: 60_000,
      onLog: () => {},
      quietHours: { start: "23:00", end: "23:01" },
    });
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: () => {},
      onLog: () => {},
    });
    await host.startInitial(runtimes);
    let sessionIds: string[] = [];
    let externalBlockers: ScopeDrainBlocker[] = [];
    const lifecycle = new ScopeLifecycleService({
      registry,
      runtimes,
      runtimeHost: host,
      bus,
      listSessionIds: () => sessionIds,
      inspectExternalBlockers: () => externalBlockers,
    });
    const events: string[] = [];
    bus.on("scope.lifecycle.changed", (event) => events.push(event.transition));

    expect(await lifecycle.registerDirectoryScope({ directoryRoot: join(stateDir, "missing") }))
      .toMatchObject({ ok: false, reason: "directory_not_found" });
    const notDirectory = join(stateDir, "not-a-directory");
    writeFileSync(notDirectory, "file");
    expect(await lifecycle.registerDirectoryScope({ directoryRoot: notDirectory }))
      .toMatchObject({ ok: false, reason: "not_directory" });
    const inaccessible = projectDir("inaccessible");
    chmodSync(inaccessible, 0o000);
    expect(await lifecycle.registerDirectoryScope({ directoryRoot: inaccessible }))
      .toMatchObject({ ok: false, reason: "directory_inaccessible" });
    chmodSync(inaccessible, 0o700);
    expect(registry.list()).toHaveLength(1);

    const registryAdd = vi.spyOn(registry, "add");
    const registryRemove = vi.spyOn(registry, "remove");
    const failedStart = vi.spyOn(host, "start").mockRejectedValueOnce(new Error("start failed"));
    expect(await lifecycle.registerDirectoryScope({ directoryRoot: scopeB }))
      .toMatchObject({ ok: false, reason: "runtime_start_failed" });
    expect(registryAdd.mock.invocationCallOrder[0])
      .toBeLessThan(failedStart.mock.invocationCallOrder[0]!);
    expect(registryRemove).toHaveBeenCalledWith(deriveDirectoryScopeId(scopeB));
    expect(registry.list()).toHaveLength(1);
    expect(runtimes.size()).toBe(1);
    expect(new ScopeRegistry({ stateDir, projects: [{ projectDir: scopeA }] }).list())
      .toHaveLength(1);
    failedStart.mockRestore();
    registryRemove.mockRestore();
    registryAdd.mockRestore();

    const startAfterPersistence = vi.spyOn(host, "start");
    const failedPersistence = vi.spyOn(registry, "add").mockImplementationOnce(() => {
      throw new JsonFileError("project-registry.json", "write", "persistence failed");
    });
    expect(await lifecycle.registerDirectoryScope({ directoryRoot: scopeB }))
      .toMatchObject({ ok: false, reason: "persistence_failed" });
    expect(startAfterPersistence).not.toHaveBeenCalled();
    expect(registry.list()).toHaveLength(1);
    expect(runtimes.size()).toBe(1);
    expect(host.hostedCount()).toBe(1);
    expect(new ScopeRegistry({ stateDir, projects: [{ projectDir: scopeA }] }).list())
      .toHaveLength(1);
    failedPersistence.mockRestore();
    startAfterPersistence.mockRestore();

    const added = await lifecycle.registerDirectoryScope({ directoryRoot: scopeB });
    expect(added.ok).toBe(true);
    const scopeBId = deriveDirectoryScopeId(scopeB);
    const alias = join(stateDir, "scope-b-alias");
    symlinkSync(scopeB, alias, "dir");
    expect(runtimes.get(scopeBId).workflowRuntime.isDispatchPaused()).toBe(false);
    expect(await lifecycle.registerDirectoryScope({ directoryRoot: alias }))
      .toMatchObject({ ok: false, reason: "duplicate_scope", scopeId: scopeBId });

    expect(await lifecycle.updateDisplayName(scopeBId, "  Renamed B  "))
      .toMatchObject({ ok: true, status: "updated", scope: { displayName: "Renamed B" } });
    expect(await lifecycle.setDefaultScope(scopeBId))
      .toMatchObject({ ok: true, status: "default_changed" });
    expect(runtimes.get(scopeAId).notificationGate).toBeNull();
    expect(runtimes.get(scopeBId).notificationGate).not.toBeNull();
    expect(await lifecycle.drainScope(scopeBId))
      .toMatchObject({ ok: false, reason: "default_scope" });
    expect(await lifecycle.removeScope(scopeBId))
      .toMatchObject({ ok: false, reason: "default_scope" });
    expect(await lifecycle.setDefaultScope(scopeAId))
      .toMatchObject({ ok: true, status: "default_changed" });
    expect(runtimes.get(scopeAId).notificationGate).not.toBeNull();
    expect(runtimes.get(scopeBId).notificationGate).toBeNull();

    const runtime = runtimes.get(scopeBId);
    const restorePendingWorkflowBuffers = mockPendingWorkflowBuffers(runtime, scopeBId);
    expect(await lifecycle.drainScope(scopeBId)).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([
        expect.objectContaining({
          kind: "pending_work",
          count: 1,
          ids: ["queued:pending-scope-work:123:1"],
          requiredDisposition: "cancel-or-complete",
        }),
        expect.objectContaining({
          kind: "pending_work",
          source: "workflow-batch-buffer",
          count: 1,
          ids: [`batch:pending-scope-work:0:${scopeBId}:all`],
          requiredDisposition: "cancel-or-complete",
        }),
        expect.objectContaining({
          kind: "pending_work",
          source: "workflow-file-watch-buffer",
          count: 1,
          ids: ["watch:pending-scope-work:0"],
          requiredDisposition: "cancel-or-complete",
        }),
      ]),
    });
    restorePendingWorkflowBuffers();

    const awaitRunDir = join(runtime.runStore.runsDir, "run-restored-await");
    writeSuspension(awaitRunDir, {
      runId: "run-restored-await",
      workflowName: "pending-scope-work",
      definitionPath: "test/pending-scope-work.ts",
      stepId: "wait-for-owner",
      event: "owner.question.resolved",
      matchField: "id",
      matchValue: "question-restored-await",
      suspendedAt: "2026-08-01T12:00:00.000Z",
    });
    const timedAwaitRunDir = join(runtime.runStore.runsDir, "run-restored-timed-await");
    writeSuspension(timedAwaitRunDir, {
      runId: "run-restored-timed-await",
      workflowName: "pending-scope-work",
      definitionPath: "test/pending-scope-work.ts",
      stepId: "wait-for-signal",
      event: "test.signal.received",
      matchField: "id",
      matchValue: "signal-restored-await",
      suspendedAt: "2026-08-01T12:00:00.000Z",
      awaitTimeoutMs: 60_000,
      deadlineAtMs: 4_000_000_000_000,
    });
    expect(await lifecycle.drainScope(scopeBId)).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([
        expect.objectContaining({
          kind: "pending_work",
          source: "workflow-await-event",
          ids: ["await:run-restored-await:wait-for-owner"],
          requiredDisposition: "deliver-event",
        }),
        expect.objectContaining({
          kind: "pending_work",
          source: "workflow-await-event",
          ids: ["await:run-restored-timed-await:wait-for-signal"],
          requiredDisposition: "deliver-or-timeout",
        }),
      ]),
    });
    clearAwaitFiles(awaitRunDir, "wait-for-owner");
    clearAwaitFiles(timedAwaitRunDir, "wait-for-signal");

    runtime.workflowRuntime.setDispatchPaused(true);
    const queued = runtime.workflowRuntime.enqueuePendingRun("pending-scope-work");
    expect(queued.ok).toBe(true);
    const approval = runtime.approvalQueue.enqueue(
      "shell",
      { command: "inspect" },
      "moderate",
      "inspect",
    );
    const releaseApprovalExecution = beginApprovalExecutionActivity(
      runtime.approvalQueue,
      [approval.id],
    );
    const execution = runtime.approvalQueue.getExecutionSnapshot(approval.id);
    if (!execution.ok) throw new Error("expected approval execution snapshot");
    expect(runtime.approvalQueue.approveForExecution(execution.snapshot.descriptor).ok)
      .toBe(true);
    sessionIds = ["session-b"];
    externalBlockers = [{
      kind: "task_claim",
      source: "autonomy",
      count: 1,
      ids: ["task-b:run-b"],
      requiredDisposition: "release-or-supersede",
      detail: "release the task claim",
    }];
    const blocked = await lifecycle.drainScope(scopeBId);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected blockers");
    expect(blocked.blockers.map((blocker) => [blocker.kind, blocker.requiredDisposition]))
      .toEqual(expect.arrayContaining([
        ["session", "close"],
        ["resource_lease", "wait-or-abort"],
        ["pending_work", "cancel-or-complete"],
        ["task_claim", "release-or-supersede"],
      ]));
    expect(blocked.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "resource_lease",
        source: "approval-execution",
        ids: [approval.id],
      }),
    ]));

    sessionIds = [];
    externalBlockers = [];
    releaseApprovalExecution();
    if (!queued.runId) throw new Error("queued run id missing");
    runtime.workflowRuntime.cancelQueuedRun(queued.runId);
    expect(await lifecycle.drainScope(scopeBId))
      .toMatchObject({ ok: true, status: "drained" });

    const lateQueued = runtime.workflowRuntime.enqueuePendingRun("pending-scope-work");
    expect(lateQueued.ok).toBe(true);
    expect(await lifecycle.removeScope(scopeBId)).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([
        expect.objectContaining({
          kind: "pending_work",
          ids: [lateQueued.runId],
          requiredDisposition: "cancel-or-complete",
        }),
      ]),
    });
    if (!lateQueued.runId) throw new Error("late queued run id missing");
    runtime.workflowRuntime.cancelQueuedRun(lateQueued.runId);

    writeFileSync(join(scopeB, "operator-owned.txt"), "preserved");
    const before = readFileSync(join(scopeB, "operator-owned.txt"), "utf8");
    expect(await lifecycle.removeScope(scopeBId))
      .toMatchObject({ ok: true, status: "removed" });
    expect(readFileSync(join(scopeB, "operator-owned.txt"), "utf8")).toBe(before);
    expect(events).toEqual(expect.arrayContaining([
      "registered",
      "display-name-updated",
      "default-changed",
      "draining",
      "drain-blocked",
      "drained",
      "removed",
    ]));
    await host.stopAll(runtimes, 0);
  });
});
