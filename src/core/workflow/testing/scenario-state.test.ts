import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { initModuleEventRegistry } from "#core/events/module-event.js";
import { defineScopedModuleEvent } from "#core/events/scope.js";
import { RunStateDatabase } from "../run-state-database.js";
import { WorkflowScenarioDriver } from "./index.js";
import { createTestTransactionalRunState } from "./run-context-fixture.js";

it.each(["valid", "wrong-scope", "invalid"] as const)(
  "prepares a finalizer handoff before committing success: %s",
  async (payloadKind) => {
    const root = mkdtempSync(join(tmpdir(), "kota-finalizer-handoff-"));
    const event = defineScopedModuleEvent<{ runId: string }>("scenario.finalizer.handoff", ["runId"], {
      payloadSchema: {
        type: "object",
        properties: { runId: { type: "string", required: true } },
        additionalProperties: false,
      },
    });
    const release = initModuleEventRegistry().acquire("scenario-finalizer", event);
    try {
      const state = createTestTransactionalRunState(join(root, "state"));
      const result = await new WorkflowScenarioDriver({
        name: "finalizer-handoff",
        repository: "none",
        triggers: [{ event: "manual" }],
        steps: [{ id: "work", type: "code", run: () => undefined }],
        finalize: (ctx) => {
          ctx.state.compareAndSet("finalized", 0, true);
          ctx.emit(event.name, payloadKind === "invalid" ? {} : {
            runId: ctx.runId,
            ...(payloadKind === "wrong-scope" ? { scopeId: "other-scope" } : {}),
          }, "handoff");
        },
      }, { workspaceRoot: root, runId: "handoff-run", ports: { state } }).run();
      const database = new RunStateDatabase(state.stateDir);
      try {
        if (payloadKind === "valid") {
          expect(result.status, result.error).toBe("success");
          const [publication] = database.listPendingPublications();
          expect(publication.payload).toEqual({ runId: "handoff-run", scopeId: state.scopeId });
          // Validate the undelivered payload directly: delivery-time scoping cannot repair this proof.
          expect(() => new EventBus().validate(event.name, { ...publication.payload })).not.toThrow();
          expect(state.read("finalized")).toEqual({ revision: 1, value: true });
        } else {
          expect(result.status).toBe("failed");
          expect(result.error).toContain(payloadKind === "wrong-scope"
            ? "does not match scoped bus" : "payload.runId is required");
          expect(database.getRun("handoff-run")?.state).toBe("needs_attention");
          expect(database.listPendingPublications()).toEqual([]);
          expect(state.read("finalized")).toEqual({ revision: 0, value: null });
        }
      } finally {
        database.close();
      }
    } finally {
      release();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("publishes staged state and events only after scenario success", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-scenario-state-"));
  try {
    const state = createTestTransactionalRunState(join(root, "state"));
    state.compareAndSet("counter", 0, { value: 1 });
    const run = (fail: boolean) => new WorkflowScenarioDriver({
      name: "transaction-scenario",
      repository: "none",
      triggers: [{ event: "scenario.requested" }],
      steps: [
        { id: "stage", type: "code", run: async (ctx) => {
          const before = ctx.state.read<{ value: number }>("counter");
          ctx.state.compareAndSet("counter", before.revision, { value: 2 });
          expect(state.read("counter")).toEqual({ revision: 1, value: { value: 1 } });
        } },
        { id: "publish", type: "emit", event: "scenario.completed" },
        { id: "settle", type: "code", run: async () => {
          if (fail) throw new Error("scenario rejected");
        } },
      ],
    }, { workspaceRoot: root, ports: { state } }).run();

    const failed = await run(true);
    expect(failed.status).toBe("failed");
    expect(failed.emitted).toEqual([]);
    expect(state.read("counter")).toEqual({ revision: 1, value: { value: 1 } });

    const succeeded = await run(false);
    expect(succeeded.status, succeeded.error).toBe("success");
    expect(succeeded.emitted).toEqual([expect.objectContaining({ event: "scenario.completed" })]);
    expect(state.read("counter")).toEqual({ revision: 2, value: { value: 2 } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The scenario API must observe the same writer publication gates as the runtime.
// This catches success inferred from steps while integration is still rejectable.
it.each(["validation", "invariant", "finalization", "success"] as const)(
  "settles writer state and events through integration: %s",
  async (outcome) => {
    const root = mkdtempSync(join(tmpdir(), "kota-scenario-writer-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Scenario"], { cwd: root });
      execFileSync("git", ["config", "user.email", "scenario@example.test"], { cwd: root });
      writeFileSync(join(root, ".gitignore"), ".kota/\n");
      execFileSync("git", ["add", ".gitignore"], { cwd: root });
      execFileSync("git", ["commit", "--quiet", "-m", "scenario input"], { cwd: root });
      const state = createTestTransactionalRunState(join(root, ".kota", "test-state"));
      state.compareAndSet("counter", 0, { value: 1 });
      let workspaceDir = "";
      const result = await new WorkflowScenarioDriver({
        name: "writer-publication-scenario",
        repository: "write",
        integration: {
          validationCommand: [process.execPath, "-e", outcome === "validation"
            ? 'console.error("validator rejected fixture"); process.exit(1)'
            : 'require("node:assert/strict").equal(require("node:fs").readFileSync("result.txt", "utf8"), "published")'],
          postReconcile: () => outcome === "invariant"
            ? { satisfied: false, reason: "scenario contract changed" }
            : { satisfied: true },
        },
        triggers: [{ event: "scenario.requested" }],
        finalize: (ctx) => {
          expect(ctx.scopeRoot).toBe(root);
          expect(ctx.stateDir).toBe(join(root, ".kota"));
          expect(existsSync(workspaceDir)).toBe(false);
          expect(readFileSync(join(ctx.scopeRoot, "result.txt"), "utf8")).toBe("published");
          ctx.state.compareAndSet("finalized", 0, true);
          ctx.emit("scenario.finalized", { runId: ctx.runId }, "finalize");
          if (outcome === "finalization") throw new Error("owner completion rejected");
        },
        steps: [
          { id: "stage", type: "code", run: async (ctx) => {
            workspaceDir = ctx.workspaceRoot;
            writeFileSync(join(ctx.workspaceRoot, "result.txt"), "published");
            ctx.state.compareAndSet("counter", 1, { value: 2 });
            expect(state.read("counter")).toEqual({ revision: 1, value: { value: 1 } });
          } },
          { id: "publish", type: "emit", event: "scenario.completed" },
        ],
      }, { workspaceRoot: root, ports: { state } }).run();

      expect(result.steps.stage.status).toBe("success");
      if (outcome === "success") {
        expect(result.status, result.error).toBe("success");
        expect(readFileSync(join(root, "result.txt"), "utf8")).toBe("published");
        expect(state.read("counter")).toEqual({ revision: 2, value: { value: 2 } });
        expect(state.read("finalized")).toEqual({ revision: 1, value: true });
        expect(result.emitted).toEqual([
          expect.objectContaining({ event: "scenario.completed" }),
          expect.objectContaining({ event: "scenario.finalized" }),
        ]);
        expect(existsSync(result.workspaceDir)).toBe(false);
      } else {
        expect(result.status).toBe("failed");
        expect(result.error).toContain(outcome === "validation"
          ? "Scenario requires integration repair:" : outcome === "invariant"
            ? "integration-invariant-failed" : "owner completion rejected");
        expect(existsSync(join(root, "result.txt"))).toBe(outcome === "finalization");
        expect(state.read("counter")).toEqual({ revision: 1, value: { value: 1 } });
        expect(state.read("finalized")).toEqual({ revision: 0, value: null });
        expect(result.emitted).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each([true, false])("checks the writer invariant with no repository changes: %s", async (accepted) => {
  const root = mkdtempSync(join(tmpdir(), "kota-scenario-no-diff-"));
  try {
    const state = createTestTransactionalRunState(root);
    const result = await new WorkflowScenarioDriver({
      name: "no-diff-writer",
      repository: "write",
      integration: {
        validationCommand: [process.execPath, "-e", "process.exit(1)"],
        postReconcile: () => accepted
          ? { satisfied: true }
          : { satisfied: false, reason: "contract changed" },
      },
      triggers: [{ event: "scenario.requested" }],
      steps: [
        { id: "stage", type: "code", run: async (ctx) => {
          ctx.state.compareAndSet("accepted", 0, true);
        } },
        { id: "publish", type: "emit", event: "scenario.completed" },
      ],
    }, { ports: { state } }).run();
    expect(result.steps.stage.status).toBe("success");
    expect(result.status, result.error).toBe(accepted ? "success" : "failed");
    expect(state.read("accepted")).toEqual(accepted
      ? { revision: 1, value: true }
      : { revision: 0, value: null });
    expect(result.emitted).toEqual(accepted
      ? [expect.objectContaining({ event: "scenario.completed" })] : []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
