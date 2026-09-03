import { describe, expect, it } from "vitest";
import { createKotaClientTestDouble } from "./daemon-client-test-support.js";
import { ScopeSelectorConflictError } from "./scope-selector.js";
import { createScopedKotaClient } from "./scoped-kota-client.js";

describe("createScopedKotaClient", () => {
  it("binds representative domain operations to one scope", async () => {
    const calls: unknown[] = [];
    const base = createKotaClientTestDouble({
      workflow: {
        listRuns: async (filter: unknown) => {
          calls.push(["workflow.listRuns", filter]);
          return { runs: [] };
        },
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
        pauseAgentForQuality: async (reason: string, selector: unknown) => {
          calls.push(["workflow.pauseAgentForQuality", reason, selector]);
          return { ok: true as const, paused: true as const, already: false };
        },
        resume: async (options: unknown, selector: unknown) => {
          calls.push(["workflow.resume", options, selector]);
          return { paused: false, already: false };
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
    });

    const scoped = createScopedKotaClient(base, "scope-b");
    await scoped.workflow.listRuns({ workflow: "builder" });
    await scoped.workflow.status();
    await scoped.workflow.pauseAgentForQuality("scope-local correction");
    await scoped.workflow.resume({ retryAgent: true });
    await scoped.approvals.list({ status: "all" });
    await scoped.tasks.list(["open"]);

    expect(calls).toEqual([
      ["workflow.listRuns", { workflow: "builder", scopeId: "scope-b" }],
      ["workflow.status", { scopeId: "scope-b" }],
      [
        "workflow.pauseAgentForQuality",
        "scope-local correction",
        { scopeId: "scope-b" },
      ],
      ["workflow.resume", { retryAgent: true }, { scopeId: "scope-b" }],
      ["approvals.list", { status: "all", scopeId: "scope-b" }],
      ["tasks.list", ["open"], { scopeId: "scope-b" }],
    ]);
  });

  it("rejects a caller selector that conflicts with the bound scope", async () => {
    const calls: unknown[] = [];
    const base = createKotaClientTestDouble({
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
    });

    const scoped = createScopedKotaClient(base, "scope-a");
    await expect(
      scoped.approvals.approve(
        "approval-1",
        "a".repeat(64),
        "ok",
        { scopeId: "scope-b" },
      ),
    ).rejects.toBeInstanceOf(ScopeSelectorConflictError);
    await expect(
      scoped.workflow.pause({ scopeId: "scope-b" }),
    ).rejects.toBeInstanceOf(ScopeSelectorConflictError);
    expect(calls).toEqual([]);
  });
});
