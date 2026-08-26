/**
 * Multi-scope daemon isolation integration test.
 *
 * Boots one `Daemon` instance configured with two scopes and asserts the
 * cross-cutting property the prior foundation slices were designed to deliver:
 * one daemon hosting two scopes produces no cross-scope leakage. Each
 * named foundation slice (registry primitive, per-scope bundle factory,
 * scopeId on event payloads, scopeId on control-API routes) ships with
 * focused unit/contract tests; this file is the end-to-end proof that they
 * compose, exercising the same shared `EventBus`, the same daemon-owned
 * scope-registry file, and the same per-scope filesystem layout that
 * production paths use.
 *
 * Coverage matrix:
 *   - emitted events  → every scope-scoped envelope carries the right
 *                        scopeId (via shared `EventBus` capture).
 *   - persisted runs  → each scope's `.kota/runs/` holds only its own runs
 *                        (via real `WorkflowRunStore` instances pointed at
 *                        each `scopeRoot`).
 *   - persisted approvals       → `.kota/approvals/` per scope.
 *   - persisted owner questions → `.kota/owner-questions/` per scope.
 *   - registered sessions → `listSessions(scopeId)` returns sessions only
 *                            for the registry's default scope (the
 *                            current daemon-default contract documented in
 *                            `daemon-handle.ts`).
 *
 * The test mocks `initTaskStore` (legacy single-scope entrypoint) for the
 * same reason the other daemon-integration tests do — the daemon's per-
 * scope bundle factory replaces it via `setTaskStoreInstance`, but
 * mocking keeps any stray legacy caller inert during the test.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { ApprovalQueue } from "./approval-queue.js";
import { Daemon } from "./daemon.js";
import { OwnerQuestionQueue } from "./owner-question-queue.js";
import { resetScheduler } from "./scheduler.js";
import {
  deriveDirectoryScopeId,
  loadRegistryFileFromDisk,
} from "./scope-registry.js";

vi.mock("./task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await wait(20);
  }
  expect(predicate()).toBe(true);
}

/**
 * Minimal `WorkflowDefinition` used to exercise per-scope `WorkflowRunStore`
 * persistence. The run-store only reads `name` / `definitionPath` /
 * `triggers` / `steps` from the definition for snapshot + metadata; the rest
 * of the surface is never observed in this test.
 */
function makeFakeWorkflowDefinition(name: string): WorkflowDefinition {
  return {
    name,
    enabled: true,
    moduleRoot: "/tmp",
    repository: "none",
    tags: [],
    definitionPath: `test/${name}.ts`,
    triggers: [],
    steps: [],
  };
}

describe("Daemon — two-scope isolation across emit/persist/session boundaries", () => {
  let stateDir: string;
  let daemonStateDir: string;
  let dirA: string;
  let dirB: string;
  let daemon: Daemon | null;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    stateDir = mkdtempSync(join(tmpdir(), "kota-multi-scope-isolation-"));
    daemonStateDir = join(stateDir, "daemon-state");
    mkdirSync(daemonStateDir, { recursive: true });
    dirA = join(stateDir, "scope-a");
    dirB = join(stateDir, "scope-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    daemon = null;
  });

  afterEach(async () => {
    if (daemon) {
      try {
        await daemon.stop(0);
      } catch {
        /* best-effort */
      }
    }
    resetEventBus();
    resetScheduler();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it(
    "boots one daemon with two scopes and keeps every event, run, approval, owner question, and session inside its own scope boundary",
    async () => {
      // Deterministic scopeId derivation from the resolved scopeRoot is
      // the same primitive the registry uses, so the test's expected ids
      // match whatever the daemon writes to disk and emits on the bus.
      const idA = deriveDirectoryScopeId(dirA);
      const idB = deriveDirectoryScopeId(dirB);
      expect(idA).not.toEqual(idB);

      // Capture every envelope that crosses the bus from daemon construction
      // forward. The envelope log is the load-bearing evidence for the
      // "every scoped emit carries the right scopeId" assertion
      // below.
      const bus = initEventBus();
      const envelopes: BusEnvelope[] = [];
      bus.on("*", (envelope) => {
        envelopes.push(envelope);
      });

      daemon = new Daemon({
        scopes: [{ scopeRoot: dirA }, { scopeRoot: dirB }],
        stateDir: daemonStateDir,
        idleIntervalMs: 1_000,
        pollIntervalMs: 60_000,
        // No workflows: the test exercises per-scope subsystems directly
        // instead of relying on the daemon's autonomous dispatch loop. This
        // keeps the test deterministic and avoids depending on any agent
        // harness.
        workflows: [],
      });

      const startPromise = daemon.start();
      try {
        await wait(60);
        expect(daemon.isRunning()).toBe(true);

        // Slice 1 contract: the registry persists both configured scopes
        // with their derived ids and picks the first as the default.
        const registry = loadRegistryFileFromDisk(daemonStateDir);
        expect(registry).not.toBeNull();
        const persistedIds = (registry?.scopes ?? [])
          .map((p) => p.scopeId)
          .sort();
        expect(persistedIds).toEqual([idA, idB].sort());
        expect(registry?.defaultScopeId).toBe(idA);

        // Scope contract: scoped events injected through a per-scope pbus
        // carry the right scopeId on every emit. Use the
        // shared bus the daemon installed and tag emits per scope. This
        // is exactly the wiring per-scope bundles use internally; the
        // test-side pbuses share that bus, so a leak in either direction
        // would show up in the captured envelopes.
        const pbusA = new ScopedEventBus(bus, idA);
        const pbusB = new ScopedEventBus(bus, idB);

        // Slice 2 contract: per-scope queues and stores, when constructed
        // against each scope's directory, persist into that scope's
        // `.kota/...` tree without leaking into the other scope's tree.
        const approvalsADir = join(dirA, ".kota", "approvals");
        const approvalsBDir = join(dirB, ".kota", "approvals");
        const ownerQADir = join(dirA, ".kota", "owner-questions");
        const ownerQBDir = join(dirB, ".kota", "owner-questions");
        const approvalA = new ApprovalQueue(approvalsADir, pbusA);
        const approvalB = new ApprovalQueue(approvalsBDir, pbusB);
        const ownerQA = new OwnerQuestionQueue(ownerQADir, pbusA);
        const ownerQB = new OwnerQuestionQueue(ownerQBDir, pbusB);
        const runStoreA = new WorkflowRunStore(dirA);
        const runStoreB = new WorkflowRunStore(dirB);

        // Snapshot the envelope log before driving scope-scoped emits.
        // Daemon startup itself produces a few daemon-wide envelopes
        // (notification gate / module-log instances, control server
        // bring-up); slicing from this point isolates the test's emits.
        const cursor = envelopes.length;

        // Drive one emit per scope per surface. Each call emits via the
        // matching pbus or persists into the matching scopeRoot.
        approvalA.enqueue("Bash", { cmd: "ls A" }, "moderate", "approve A");
        approvalB.enqueue("Bash", { cmd: "ls B" }, "moderate", "approve B");
        ownerQA.enqueue({
          context: "context A",
          question: "decide A?",
          reason: "needed for A",
          source: "test-A",
          answerBehavior: "record-only",
          origin: { kind: "manual", source: "test-A" },
        });
        ownerQB.enqueue({
          context: "context B",
          question: "decide B?",
          reason: "needed for B",
          source: "test-B",
          answerBehavior: "record-only",
          origin: { kind: "manual", source: "test-B" },
        });

        // Scope-scoped lifecycle events emitted directly through the
        // pbus — the same path the per-scope workflow runtime uses when
        // a run starts/completes. Verifying these here proves the typed
        // bus contract end-to-end without spinning up a workflow agent.
        pbusA.emit("workflow.started", {
          workflow: "wf-a",
          runId: "run-a",
          triggerEvent: "manual",
          definitionPath: "test/wf-a.ts",
          runDir: ".kota/runs/run-a",
          startedAt: new Date().toISOString(),
        });
        pbusB.emit("workflow.started", {
          workflow: "wf-b",
          runId: "run-b",
          triggerEvent: "manual",
          definitionPath: "test/wf-b.ts",
          runDir: ".kota/runs/run-b",
          startedAt: new Date().toISOString(),
        });

        // Persisted runs land in each scope's own `.kota/runs/` tree.
        runStoreA.createRun(makeFakeWorkflowDefinition("wf-a"), {
          event: "manual",
          schemaRef: null, payload: {},
        });
        runStoreB.createRun(makeFakeWorkflowDefinition("wf-b"), {
          event: "manual",
          schemaRef: null, payload: {},
        });

        // ---- Assertions ----

        // 1. Scoped envelopes never carry the wrong scopeId.
        // Loop over every envelope produced after the cursor; whenever
        // `scopeId` is present, it must match exactly one of the two
        // configured directory scopes. A subtle leak (forgotten getDefault(),
        // wrong pbus, typo in a route filter) would fail here with the
        // offending envelope's payload printed.
        const newEnvelopes = envelopes.slice(cursor);
        const scopeScoped = newEnvelopes.filter(
          (env) => typeof (env.payload as { scopeId?: unknown }).scopeId === "string",
        );
        expect(
          scopeScoped.length,
          "expected scope-scoped envelopes from per-scope queue/lifecycle emits",
        ).toBeGreaterThan(0);
        for (const env of scopeScoped) {
          const payload = env.payload as { scopeId?: unknown };
          if (typeof payload.scopeId !== "string") {
            throw new Error(`envelope ${env.type} is missing scopeId`);
          }
          const scopeId = payload.scopeId;
          expect(
            [idA, idB],
            `envelope ${env.type} carried unknown scopeId=${String(scopeId)} on payload ${JSON.stringify(env.payload)}`,
          ).toContain(scopeId);
        }

        // 2. Per-scope event-name set: each scope sees its own
        // approval/owner-question/workflow-lifecycle emits and never the
        // other's. Sorted lists pinpoint a missing or stray emit.
        const namesFor = (scopeId: string): string[] =>
          scopeScoped
            .filter(
              (env) =>
                (env.payload as { scopeId: string }).scopeId === scopeId,
            )
            .map((env) => env.type)
            .sort();
        const expectedNames = [
          "approval.changed",
          "approval.requested",
          "owner.question.asked",
          "owner.question.changed",
          "workflow.started",
        ].sort();
        expect(
          namesFor(idA),
          `scope A (${idA}) scope-scoped events did not match expected set`,
        ).toEqual(expectedNames);
        expect(
          namesFor(idB),
          `scope B (${idB}) scope-scoped events did not match expected set`,
        ).toEqual(expectedNames);

        // 3. Persisted approvals and owner questions land only in the
        // matching scope's directory.
        const filesIn = (dir: string): string[] =>
          existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
        expect(filesIn(approvalsADir).length).toBe(1);
        expect(filesIn(approvalsBDir).length).toBe(1);
        expect(filesIn(ownerQADir).length).toBe(1);
        expect(filesIn(ownerQBDir).length).toBe(1);
        // Cross-check that A's approval file is not also present in B's
        // tree (and vice versa). Names are random, but a leak that wrote
        // both scopes' approvals into one directory would be caught by
        // the count check above; the explicit cross-read makes the
        // failure mode "scope X approval visible in scope Y" rather
        // than only "wrong total count".
        const approvalA0 = approvalA.list();
        const approvalB0 = approvalB.list();
        expect(approvalA0).toHaveLength(1);
        expect(approvalB0).toHaveLength(1);
        expect(
          approvalA0[0]!.id,
          `scope A approval id ${approvalA0[0]!.id} must not appear in scope B's queue`,
        ).not.toBe(approvalB0[0]!.id);
        const ownerA0 = ownerQA.list();
        const ownerB0 = ownerQB.list();
        expect(ownerA0).toHaveLength(1);
        expect(ownerB0).toHaveLength(1);
        expect(
          ownerA0[0]!.id,
          `scope A owner question id ${ownerA0[0]!.id} must not appear in scope B's queue`,
        ).not.toBe(ownerB0[0]!.id);

        // 4. Persisted runs land in each scope's own runs directory.
        // Listing one scope's runs must not return the other's run.
        const runsA = runStoreA.listRuns();
        const runsB = runStoreB.listRuns();
        expect(
          runsA.map((r) => r.workflow).sort(),
          `scope A run store leaked: ${runsA.map((r) => r.workflow).join(",")}`,
        ).toEqual(["wf-a"]);
        expect(
          runsB.map((r) => r.workflow).sort(),
          `scope B run store leaked: ${runsB.map((r) => r.workflow).join(",")}`,
        ).toEqual(["wf-b"]);
        expect(existsSync(join(dirA, ".kota", "runs"))).toBe(true);
        expect(existsSync(join(dirB, ".kota", "runs"))).toBe(true);

        // The on-disk run metadata must point back to its own scope's
        // runDir (relative to the scope root). A regression that wrote
        // scope A's run into scope B's tree would show up here as a
        // metadata.json found under the wrong scope root.
        for (const meta of runsA) {
          const onDiskPath = join(dirA, ".kota", "runs", meta.id, "metadata.json");
          expect(
            existsSync(onDiskPath),
            `scope A run ${meta.id} expected at ${onDiskPath}`,
          ).toBe(true);
          expect(
            existsSync(join(dirB, ".kota", "runs", meta.id, "metadata.json")),
            `scope A run ${meta.id} leaked into scope B's runs dir`,
          ).toBe(false);
        }
        for (const meta of runsB) {
          const onDiskPath = join(dirB, ".kota", "runs", meta.id, "metadata.json");
          expect(
            existsSync(onDiskPath),
            `scope B run ${meta.id} expected at ${onDiskPath}`,
          ).toBe(true);
          expect(
            existsSync(join(dirA, ".kota", "runs", meta.id, "metadata.json")),
            `scope B run ${meta.id} leaked into scope A's runs dir`,
          ).toBe(false);
        }

        // 5. Sessions: serve-registered sessions carry the selected scope.
        // Read the daemon-control file the daemon wrote at startup, then
        // exercise the session HTTP routes with scope filters.
        const controlPayload = JSON.parse(
          readFileSync(
            join(daemonStateDir, "daemon-control.json"),
            "utf-8",
          ),
        ) as { port: number; token: string };
        const baseUrl = `http://127.0.0.1:${controlPayload.port}`;
        const authHeaders = {
          authorization: `Bearer ${controlPayload.token}`,
          "content-type": "application/json",
        };

        const defaultSessionId = "test-session-default";
        const registerDefaultResp = await fetch(`${baseUrl}/sessions/register`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            id: defaultSessionId,
            createdAt: new Date().toISOString(),
            autonomyMode: "supervised",
          }),
        });
        expect(registerDefaultResp.status).toBe(200);

        const scopedSessionId = "test-session-non-default";
        const registerScopedResp = await fetch(
          `${baseUrl}/sessions/register?scopeId=${idB}`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              id: scopedSessionId,
              createdAt: new Date().toISOString(),
              autonomyMode: "supervised",
            }),
          },
        );
        expect(registerScopedResp.status).toBe(200);

        // Listing without scopeId follows the daemon's default scope.
        const listAllResp = await fetch(`${baseUrl}/sessions`, {
          headers: authHeaders,
        });
        expect(listAllResp.status).toBe(200);
        const listAll = (await listAllResp.json()) as {
          sessions: Array<{ id: string; scopeId: string }>;
        };
        const allIds = listAll.sessions.map((s) => s.id).sort();
        expect(allIds).toContain(defaultSessionId);
        expect(allIds).not.toContain(scopedSessionId);

        // Listing scoped to the default scope surfaces the session.
        const listDefaultResp = await fetch(
          `${baseUrl}/sessions?scopeId=${idA}`,
          { headers: authHeaders },
        );
        expect(listDefaultResp.status).toBe(200);
        const listDefault = (await listDefaultResp.json()) as {
          sessions: Array<{ id: string; scopeId: string }>;
        };
        expect(listDefault.sessions).toContainEqual(
          expect.objectContaining({
            id: defaultSessionId,
            scopeId: idA,
          }),
        );
        expect(listDefault.sessions.map((s) => s.id)).not.toContain(scopedSessionId);

        // Listing scoped to the non-default scope surfaces only the
        // session registered against that scope.
        const listNonDefaultResp = await fetch(
          `${baseUrl}/sessions?scopeId=${idB}`,
          { headers: authHeaders },
        );
        expect(listNonDefaultResp.status).toBe(200);
        const listNonDefault = (await listNonDefaultResp.json()) as {
          sessions: Array<{ id: string; scopeId: string }>;
        };
        expect(listNonDefault.sessions).toContainEqual(
          expect.objectContaining({
            id: scopedSessionId,
            scopeId: idB,
          }),
        );
        expect(listNonDefault.sessions.map((s) => s.id)).not.toContain(defaultSessionId);
      } finally {
        if (daemon) {
          await daemon.stop(0);
          await startPromise;
          daemon = null;
        }
      }
    },
    20_000,
  );

  it("starts workflow event listeners for non-default configured scopes", async () => {
    const idA = deriveDirectoryScopeId(dirA);
    const idB = deriveDirectoryScopeId(dirB);
    const bus = initEventBus();

    daemon = new Daemon({
      scopes: [{ scopeRoot: dirA }, { scopeRoot: dirB }],
      stateDir: daemonStateDir,
      idleIntervalMs: 1_000,
      pollIntervalMs: 60_000,
      workflows: [
        registerWorkflowDefinition("test/non-default-event.ts", {
          name: "non-default-event-listener",
          repository: "none",
          triggers: [{ event: "test.scope.event" }],
          steps: [
            {
              id: "mark-scope",
              type: "code",
              run: ({ scopeRoot }) => {
                return { marked: true, scopeRoot };
              },
            },
          ],
        }),
      ],
    });

    const startPromise = daemon.start();
    try {
      await wait(80);
      expect(daemon.isRunning()).toBe(true);

      new ScopedEventBus(bus, idB).emitDynamic("test.scope.event", {
        marker: "scope-b",
      });

      await waitFor(() =>
        new WorkflowRunStore(dirB).listRuns().some(
          (run) => run.workflow === "non-default-event-listener" && run.status === "success",
        ),
      );
      expect(
        new WorkflowRunStore(dirA).listRuns().filter(
          (run) => run.workflow === "non-default-event-listener",
        ),
      ).toHaveLength(0);
      expect(
        new WorkflowRunStore(dirB).listRuns().filter(
          (run) => run.workflow === "non-default-event-listener",
        ),
      ).toHaveLength(1);
      expect(idA).not.toBe(idB);
    } finally {
      if (daemon) {
        await daemon.stop(0);
        await startPromise;
        daemon = null;
      }
    }
  });
});
