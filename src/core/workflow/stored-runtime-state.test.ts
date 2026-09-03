import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_BACKOFF_OPERATOR_RETRY_UNTIL } from "./agent-backoff.js";
import { RunStateDatabase } from "./run-state-database.js";
import { ScopeRuntimeStateStore } from "./scope-runtime-state.js";
import {
  clearStoredAgentBackoff,
  readStoredWorkflowRuntimeState,
  setStoredDispatchPaused,
} from "./stored-runtime-state.js";

describe("stored workflow runtime state", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("does not create a database while reading missing offline state", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-offline-state-"));
    roots.push(workspaceRoot);
    const stateDir = join(workspaceRoot, "explicit-daemon-state");

    expect(readStoredWorkflowRuntimeState(workspaceRoot, stateDir)).toMatchObject({
      activeRuns: [],
      pendingRuns: [],
      operatorPaused: false,
    });
    expect(existsSync(stateDir)).toBe(false);
  });

  it("does not create a database for offline mutation", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-offline-control-"));
    roots.push(workspaceRoot);
    const stateDir = join(workspaceRoot, "explicit-daemon-state");

    expect(() => setStoredDispatchPaused(workspaceRoot, stateDir, true)).toThrow(
      /no canonical workflow state/i,
    );
    expect(existsSync(stateDir)).toBe(false);
  });

  it("clears one scope incident without releasing a sibling's preserved work", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "kota-offline-scope-state-"));
    const scopeA = mkdtempSync(join(tmpdir(), "kota-offline-scope-a-"));
    const scopeB = mkdtempSync(join(tmpdir(), "kota-offline-scope-b-"));
    roots.push(stateDir, scopeA, scopeB);
    const database = new RunStateDatabase(stateDir);
    database.registerScope({
      id: "scope-a",
      rootPath: scopeA,
      createdAt: "2026-09-02T10:00:00.000Z",
    });
    database.registerScope({
      id: "scope-b",
      rootPath: scopeB,
      createdAt: "2026-09-02T10:00:00.000Z",
    });
    for (const scopeId of ["scope-a", "scope-b"]) {
      database.admitRun({
        id: `run-${scopeId}`,
        scopeId,
        workflow: "builder",
        repository: "none",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-09-02T10:00:00.000Z",
        notBeforeAt: AGENT_BACKOFF_OPERATOR_RETRY_UNTIL,
      });
    }
    const scopeState = new ScopeRuntimeStateStore(database, "scope-b");
    scopeState.setAgentBackoff({
      runtimeId: "agy:antigravity-cli",
      kind: "quality",
      failureCount: 1,
      until: "2026-09-02T16:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
      reason: "repeated empty output",
    });
    database.close();

    expect(clearStoredAgentBackoff(scopeB, stateDir)).toBe(true);
    const verified = RunStateDatabase.openReadOnly(stateDir);
    expect(new ScopeRuntimeStateStore(verified, "scope-b").getAgentBackoff()).toBeNull();
    expect(verified.getRun("run-scope-a")?.notBeforeAt).toBe(
      AGENT_BACKOFF_OPERATOR_RETRY_UNTIL,
    );
    expect(verified.getRun("run-scope-b")?.notBeforeAt).not.toBe(
      AGENT_BACKOFF_OPERATOR_RETRY_UNTIL,
    );
    verified.close();
  });
});
