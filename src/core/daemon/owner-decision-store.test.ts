import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  type OwnerDecisionRecord,
  OwnerDecisionStore,
  projectOwnerDecisionForClient,
} from "./owner-decision-store.js";

function baseDecision() {
  return {
    request: {
      kind: "single-choice" as const,
      prompt: "Choose the architecture option.",
      options: [
        { id: "a", label: "Keep current boundary" },
        { id: "b", label: "Move to module-owned adapter" },
      ],
    },
    requester: {
      kind: "workflow" as const,
      workflowName: "builder",
      runId: "run-1",
      stepId: "ask",
      taskId: "task-1",
    },
    evidence: [{ summary: "Architecture task requires owner choice." }],
  };
}

describe("OwnerDecisionStore", () => {
  let root: string;
  let dir: string;
  let store: OwnerDecisionStore;
  let events: Array<{ id: string; status: OwnerDecisionRecord["status"] }>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "owner-decision-store-"));
    dir = join(root, "owner-decisions");
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "scope-a");
    events = [];
    bus.on("owner.decision.resolved", (payload) => {
      events.push({ id: payload.id, status: payload.status });
    });
    store = new OwnerDecisionStore(dir, "scope-a", pbus);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates, validates, answers, and lists typed persisted decisions", () => {
    const decision = store.create(baseDecision());
    expect(decision.status).toBe("pending");
    expect(decision.scopeId).toBe("scope-a");

    expect(() =>
      store.answer(decision.id, { kind: "single-choice", optionId: "missing" }, "test"),
    ).toThrow(/unrecognized option id/);

    const answered = store.answer(decision.id, { kind: "single-choice", optionId: "b" }, "test");
    expect(answered?.status).toBe("answered");
    expect(store.list("answered").map((item) => item.id)).toEqual([decision.id]);
    expect(events).toEqual([{ id: decision.id, status: "answered" }]);
  });

  it("expires and cancels pending decisions", () => {
    const stale = store.create({
      ...baseDecision(),
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const cancelable = store.create(baseDecision());

    expect(store.expireStale(Date.parse("2026-01-01T00:00:00.000Z")).map((item) => item.id)).toEqual([stale.id]);
    expect(store.get(stale.id)?.status).toBe("expired");

    const canceled = store.cancel(cancelable.id, "scope changed", "test");
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.canceledReason).toBe("scope changed");
  });

  it("rejects path traversal ids before reading persisted records", () => {
    writeFileSync(join(root, "secrets.json"), JSON.stringify({ token: "raw-secret" }));

    expect(store.get("../secrets")).toBeNull();
    expect(store.answer("../secrets", { kind: "single-choice", optionId: "a" }, "test")).toBeNull();
    expect(store.cancel("../secrets", "nope", "test")).toBeNull();
    expect(store.consumeForAction("../secrets", {
      workflowName: "builder",
      runId: "run-1",
      stepId: "consume",
      actionId: "book-slot",
      adapterName: "calendar",
      approvalId: null,
    })).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects duplicate confirmed-action consumption", () => {
    const decision = store.create({
      ...baseDecision(),
      action: {
        actionId: "book-slot",
        adapterName: "calendar",
        description: "Book the selected slot",
        dryRun: false,
        requiresConfirmation: true,
        dangerousEffect: true,
        authorizingSelection: { kind: "single-choice", optionId: "a" },
      },
    });
    store.answer(decision.id, { kind: "single-choice", optionId: "a" }, "test");

    const first = store.consumeForAction(decision.id, {
      workflowName: "builder",
      runId: "run-1",
      stepId: "book",
      actionId: "book-slot",
      adapterName: "calendar",
      approvalId: "approval-1",
    });
    expect(first.ok).toBe(true);

    const second = store.consumeForAction(decision.id, {
      workflowName: "builder",
      runId: "run-1",
      stepId: "book-again",
      actionId: "book-slot",
      adapterName: "calendar",
      approvalId: "approval-1",
    });
    expect(second).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("rejects confirmed action metadata with an invalid authorizing selection", () => {
    expect(() =>
      store.create({
        ...baseDecision(),
        action: {
          actionId: "book-slot",
          adapterName: "calendar",
          description: "Book the selected slot",
          dryRun: false,
          requiresConfirmation: true,
          dangerousEffect: true,
          authorizingSelection: { kind: "single-choice", optionId: "missing" },
        },
      }),
    ).toThrow(/unrecognized option id/);
  });

  it("redacts sensitive form fields before persistence and client projection", () => {
    const decision = store.create({
      request: {
        kind: "form",
        prompt: "Store provider reference.",
        fields: [
          { id: "apiToken", label: "API token", type: "text", required: true },
          { id: "destination", label: "Destination", type: "text", required: true },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Projection should not expose sensitive values." }],
    });
    const answered = store.answer(
      decision.id,
      { kind: "form", fields: { apiToken: "secret-value", destination: "calendar" } },
      "test",
    );
    expect(answered).not.toBeNull();
    expect(answered?.selectedValue).toEqual({
      kind: "form",
      fields: { apiToken: "[redacted]", destination: "calendar" },
    });

    const persisted = readFileSync(join(dir, `${decision.id}.json`), "utf-8");
    expect(persisted).not.toContain("secret-value");
    expect(store.get(decision.id)?.selectedValue).toEqual({
      kind: "form",
      fields: { apiToken: "[redacted]", destination: "calendar" },
    });

    const projected = projectOwnerDecisionForClient(answered!);
    expect(projected.selectedValue).toEqual({
      kind: "form",
      fields: { apiToken: "[redacted]", destination: "calendar" },
    });
  });
});
