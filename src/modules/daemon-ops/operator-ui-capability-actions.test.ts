import { describe, expect, it, vi } from "vitest";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { executeCapabilityUiAction } from "./operator-ui-capability-actions.js";

function projectionClient(): KotaClient {
  return createKotaClientTestDouble({
    recall: {
      recall: async () => ({ ok: false, reason: "semantic_unavailable" }),
    },
    answer: {
      answer: async () => ({ ok: false, reason: "no_hits" }),
      log: async () => ({ entries: [] }),
      show: async () => ({ ok: false, reason: "not_found" }),
    },
    capture: {
      capture: async () => ({
        ok: false,
        reason: "ambiguous",
        suggestions: ["memory", "knowledge", "tasks", "inbox"],
      }),
    },
    retract: {
      retract: async (request) => ({
        ok: false,
        reason: "not_found",
        target: request.target,
        identifier: request.identifier,
      }),
    },
    config: {
      validate: async () => ({ sources: [], warnings: [], resolved: {} }),
      get: async () => ({ found: false, reason: "not_found" }),
      set: async () => ({
        ok: true,
        unknownKey: false,
        topKey: "defaultAgentHarness",
        value: "codex",
      }),
    },
    audit: {
      list: async () => ({ entries: [] }),
    },
    workflow: {
      getRun: async () => ({ found: false }),
    },
    history: {
      show: async () => ({ found: false }),
    },
  });
}

describe("capability shared UI actions", () => {
  it("dispatches every migrated operator capability through its typed client namespace", async () => {
    const client = projectionClient();
    const results = await Promise.all([
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "recall", method: "recall" },
        parameters: { query: "shared UI", topK: 5 },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "answer", method: "answer" },
        parameters: { query: "What changed?" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "answer", method: "log" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "answer", method: "show" },
        parameters: { answerId: "answer-1" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "capture", method: "capture" },
        parameters: { text: "Remember the shared UI", target: "knowledge" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "retract", method: "retract" },
        parameters: { target: "knowledge", identifier: "shared-ui" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "config", method: "validate" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "config", method: "get" },
        parameters: { key: "defaultAgentHarness" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "config", method: "set" },
        parameters: { key: "defaultAgentHarness", value: "codex" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "audit", method: "list" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "workflow", method: "getRun" },
        parameters: { runId: "run-1" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "workflow", method: "compareRuns" },
        parameters: { runIdA: "run-1", runIdB: "run-2" },
      }),
      executeCapabilityUiAction({
        client,
        operation: { kind: "client-namespace", namespace: "history", method: "show" },
        parameters: { historyId: "conversation-1" },
      }),
    ]);

    expect(results).toHaveLength(13);
    expect(results.every((result) => result !== null)).toBe(true);
    expect(results[2]).toEqual({ ok: true, message: "No answers in history." });
    expect(results[6]).toEqual({ ok: true, message: "0 source(s); 0 warning(s)." });
    expect(results[8]).toEqual({ ok: true, message: "Updated defaultAgentHarness." });
    expect(results[9]).toEqual({ ok: true, message: "No guardrail audit entries." });
    expect(results[10]).toMatchObject({ ok: false, reason: "not_found" });
    expect(results[11]).toMatchObject({ ok: false, reason: "not_found" });
    expect(results[12]).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rejects missing parameters before invoking a capability client", async () => {
    const result = await executeCapabilityUiAction({
      client: projectionClient(),
      operation: { kind: "client-namespace", namespace: "capture", method: "capture" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid-input",
      message: "text is required.",
    });
  });

  it("executes preserved task, approval, owner-question, session, and knowledge controls through real namespaces", async () => {
    const approve = vi.fn(async () => ({
      ok: true as const,
      approval: {} as never,
      resolution: { kind: "workflow_gate_approved" as const },
    }));
    const reject = vi.fn(async () => ({ ok: true as const, approval: {} as never }));
    const answer = vi.fn(async () => ({ ok: true as const, question: {} as never }));
    const dismiss = vi.fn(async () => ({ ok: true as const, question: {} as never }));
    const move = vi.fn(async () => ({
      ok: true as const,
      id: "task-ui",
      fromState: "blocked" as const,
      toState: "open" as const,
      path: "data/tasks/task-ui.md",
      previousPath: "data/tasks/task-ui.md",
    }));
    const updateBody = vi.fn(async () => ({
      ok: true as const,
      id: "task-ui",
      state: "open" as const,
      content: "---\nstatus: open\npriority: p2\n---\n\n# Updated\n",
    }));
    const setAutonomyMode = vi.fn(async () => ({
      ok: true as const,
      autonomyMode: "autonomous" as const,
      source: "daemon" as const,
      serveOwned: false,
    }));
    const search = vi.fn(async () => ({
      ok: true as const,
      entries: [{
        id: "knowledge-1",
        title: "Shared UI",
        type: "note",
        tags: [],
        status: "active",
        created: "2026-08-02T00:00:00.000Z",
        updated: "2026-08-02T00:00:00.000Z",
        content: "Shared UI details",
        meta: {},
      }],
    }));
    const client = createKotaClientTestDouble({
      approvals: { approve, reject },
      ownerQuestions: { answer, dismiss },
      tasks: { move, updateBody },
      sessions: { setAutonomyMode },
      knowledge: { search },
    });

    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "approvals", method: "resolve" },
      parameters: { approvalId: "a1b2c3d4", decision: "approve", reviewDigest: "digest-1" },
    })).resolves.toEqual({ ok: true, message: "Approved workflow gate a1b2c3d4." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "approvals", method: "resolve" },
      parameters: { approvalId: "a1b2c3d4", decision: "reject", note: "Not now" },
    })).resolves.toEqual({ ok: true, message: "Rejected approval a1b2c3d4." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "ownerQuestions", method: "resolve" },
      parameters: { questionId: "question-1", decision: "answer", answer: "Continue" },
    })).resolves.toEqual({ ok: true, message: "Answered owner question question-1." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "ownerQuestions", method: "resolve" },
      parameters: { questionId: "question-1", decision: "dismiss", reason: "Obsolete" },
    })).resolves.toEqual({ ok: true, message: "Dismissed owner question question-1." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "tasks", method: "move" },
      parameters: { taskId: "task-ui", state: "open" },
    })).resolves.toEqual({ ok: true, message: "Moved task-ui from blocked to open." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "tasks", method: "updateBody" },
      parameters: { taskId: "task-ui", body: "Updated" },
    })).resolves.toEqual({ ok: true, message: "Updated task-ui." });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "sessions", method: "setAutonomyMode" },
      parameters: { sessionId: "session-1", autonomyMode: "autonomous" },
    })).resolves.toMatchObject({ ok: true, message: expect.stringContaining("autonomous") });
    await expect(executeCapabilityUiAction({
      client,
      operation: { kind: "client-namespace", namespace: "knowledge", method: "search" },
      parameters: { query: "shared UI", semantic: true, limit: 5 },
    })).resolves.toEqual({
      ok: true,
      message: "knowledge-1 · Shared UI · note · active",
    });

    expect(approve).toHaveBeenCalledWith("a1b2c3d4", "digest-1", undefined);
    expect(reject).toHaveBeenCalledWith("a1b2c3d4", "Not now");
    expect(answer).toHaveBeenCalledWith("question-1", "Continue");
    expect(dismiss).toHaveBeenCalledWith("question-1", "Obsolete");
    expect(move).toHaveBeenCalledWith("task-ui", "open");
    expect(updateBody).toHaveBeenCalledWith("task-ui", "Updated");
    expect(setAutonomyMode).toHaveBeenCalledWith("session-1", "autonomous");
    expect(search).toHaveBeenCalledWith("shared UI", { semantic: true, limit: 5 });
  });
});
