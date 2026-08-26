import { describe, expect, it } from "vitest";
import type { KotaClient } from "./kota-client.js";
import { ScopeSelectorConflictError } from "./scope-selector.js";
import { createScopedKotaClient } from "./scoped-kota-client.js";

describe("createScopedKotaClient", () => {
  it("binds representative domain operations to one scope", async () => {
    const calls: unknown[] = [];
    const base = {
      workflow: {
        status: async (filter: unknown) => {
          calls.push(["workflow.status", filter]);
          return {
            activeRuns: [],
            pendingRuns: [],
            queueLength: 0,
            completedRuns: 0,
            workflows: {},
            paused: false,
            pendingAbort: false,
            concurrency: 4,
          };
        },
      },
      approvals: {
        list: async (filter: unknown) => {
          calls.push(["approvals.list", filter]);
          return { approvals: [] };
        },
      },
      tasks: {
        list: async (states: unknown, selector: unknown) => {
          calls.push(["tasks.list", states, selector]);
          return { tasks: [] };
        },
      },
    } as unknown as KotaClient;

    const scoped = createScopedKotaClient(base, "scope-b");
    await scoped.workflow.status();
    await scoped.approvals.list({ status: "all" });
    await scoped.tasks.list(["ready"]);

    expect(calls).toEqual([
      ["workflow.status", { scopeId: "scope-b" }],
      ["approvals.list", { status: "all", scopeId: "scope-b" }],
      ["tasks.list", ["ready"], { scopeId: "scope-b" }],
    ]);
  });

  it("rejects a caller selector that conflicts with the bound scope", async () => {
    const calls: unknown[] = [];
    const base = {
      approvals: {
        approve: async (
          id: string,
          reviewDigest: string,
          note: string | undefined,
          selector: unknown,
        ) => {
          calls.push([id, reviewDigest, note, selector]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
    } as unknown as KotaClient;

    const scoped = createScopedKotaClient(base, "scope-a");
    await expect(
      scoped.approvals.approve(
        "approval-1",
        "a".repeat(64),
        "ok",
        { scopeId: "scope-b" },
      ),
    ).rejects.toBeInstanceOf(ScopeSelectorConflictError);
    expect(calls).toEqual([]);
  });
});
