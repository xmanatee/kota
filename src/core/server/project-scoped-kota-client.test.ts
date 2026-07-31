import { describe, expect, it } from "vitest";
import type { KotaClient } from "./kota-client.js";
import {
  createProjectScopedKotaClient,
  createScopeScopedKotaClient,
} from "./project-scoped-kota-client.js";
import { ScopeSelectorConflictError } from "./scope-selector.js";

describe("createProjectScopedKotaClient", () => {
  it("injects projectId into UI projection and action lookup", async () => {
    const calls: unknown[] = [];
    const base = {
      workflow: {},
      ui: {
        listSurfaces: async (selector: unknown) => {
          calls.push(["ui.listSurfaces", selector]);
          return { protocolVersion: "ui.surface.v1" as const, surfaces: [] };
        },
        executeAction: async (input: unknown) => {
          calls.push(["ui.executeAction", input]);
          return { ok: false as const, reason: "not_found" as const, message: "missing" };
        },
        watchEvents: async function* () {},
      },
    } as unknown as KotaClient;

    const scoped = createProjectScopedKotaClient(base, "project-b");
    await scoped.ui.listSurfaces();
    await scoped.ui.executeAction({ surfaceId: "runs", actionId: "workflow.status" });

    expect(calls).toEqual([
      ["ui.listSurfaces", { projectId: "project-b" }],
      ["ui.executeAction", {
        surfaceId: "runs",
        actionId: "workflow.status",
        projectId: "project-b",
      }],
    ]);
  });

  it("injects projectId into every secrets operation", async () => {
    const calls: unknown[] = [];
    const base = {
      forProject: () => {
        throw new Error("unexpected call");
      },
      forScope: () => {
        throw new Error("unexpected call");
      },
      secrets: {
        list: async (project: unknown) => {
          calls.push(["secrets.list", project]);
          return { secrets: [] };
        },
        get: async (name: string, project: unknown) => {
          calls.push(["secrets.get", name, project]);
          return { found: false as const };
        },
        set: async (name: string, value: string, scope: string, project: unknown) => {
          calls.push(["secrets.set", name, value, scope, project]);
          return { ok: true as const };
        },
        remove: async (name: string, scope: string, project: unknown) => {
          calls.push(["secrets.remove", name, scope, project]);
          return { ok: true as const };
        },
      },
    } as unknown as KotaClient;

    const scoped = createProjectScopedKotaClient(base, "project-b");
    await scoped.secrets.list();
    await scoped.secrets.get("TOKEN");
    await scoped.secrets.set("TOKEN", "value", "project");
    await scoped.secrets.remove("TOKEN", "project");

    expect(calls).toEqual([
      ["secrets.list", { projectId: "project-b" }],
      ["secrets.get", "TOKEN", { projectId: "project-b" }],
      ["secrets.set", "TOKEN", "value", "project", { projectId: "project-b" }],
      ["secrets.remove", "TOKEN", "project", { projectId: "project-b" }],
    ]);
  });

  it("injects projectId into approvals, ownerDecisions, and ownerQuestions namespaces", async () => {
    const calls: unknown[] = [];
    const base = {
      forProject: () => {
        throw new Error("unexpected call");
      },
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
            agentConcurrency: 1,
            codeConcurrency: 4,
          };
        },
        trial: async (_name: string, options: unknown) => {
          calls.push(["workflow.trial", options]);
          return {
            ok: false as const,
            reason: "daemon_required" as const,
            message: "stub",
          };
        },
      },
      approvals: {
        list: async (filter: unknown) => {
          calls.push(["approvals.list", filter]);
          return { approvals: [] };
        },
        approve: async (
          id: string,
          reviewDigest: string,
          note: string | undefined,
          project: unknown,
        ) => {
          calls.push(["approvals.approve", id, reviewDigest, note, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
        reject: async (id: string, reason: string | undefined, project: unknown) => {
          calls.push(["approvals.reject", id, reason, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
      ownerDecisions: {
        list: async (filter: unknown) => {
          calls.push(["ownerDecisions.list", filter]);
          return { decisions: [] };
        },
        show: async (id: string, project: unknown) => {
          calls.push(["ownerDecisions.show", id, project]);
          return { found: false as const };
        },
        answer: async (id: string, selectedValue: unknown, project: unknown) => {
          calls.push(["ownerDecisions.answer", id, selectedValue, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
        cancel: async (id: string, reason: string, project: unknown) => {
          calls.push(["ownerDecisions.cancel", id, reason, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
      ownerQuestions: {
        list: async (filter: unknown) => {
          calls.push(["ownerQuestions.list", filter]);
          return { questions: [] };
        },
        answer: async (id: string, answer: string, project: unknown) => {
          calls.push(["ownerQuestions.answer", id, answer, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
        dismiss: async (id: string, reason: string | undefined, project: unknown) => {
          calls.push(["ownerQuestions.dismiss", id, reason, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
    } as unknown as KotaClient;

    const scoped = createProjectScopedKotaClient(base, "project-b");
    await scoped.workflow.status();
    await scoped.workflow.trial("builder", { payload: { x: 1 } });
    await scoped.approvals.list({ status: "all" });
    await scoped.approvals.approve("approval-1", "a".repeat(64), "ok");
    await scoped.approvals.reject("approval-2", "no");
    await scoped.ownerDecisions.list({ status: "pending" });
    await scoped.ownerDecisions.show("decision-1");
    await scoped.ownerDecisions.answer("decision-1", { kind: "single-choice", optionId: "yes" });
    await scoped.ownerDecisions.cancel("decision-2", "stale");
    await scoped.ownerQuestions.list({ status: "pending" });
    await scoped.ownerQuestions.answer("question-1", "yes");
    await scoped.ownerQuestions.dismiss("question-2", "stale");

    expect(calls).toEqual([
      ["workflow.status", { projectId: "project-b" }],
      ["workflow.trial", { payload: { x: 1 }, projectId: "project-b" }],
      ["approvals.list", { status: "all", projectId: "project-b" }],
      ["approvals.approve", "approval-1", "a".repeat(64), "ok", { projectId: "project-b" }],
      ["approvals.reject", "approval-2", "no", { projectId: "project-b" }],
      ["ownerDecisions.list", { status: "pending", projectId: "project-b" }],
      ["ownerDecisions.show", "decision-1", { projectId: "project-b" }],
      ["ownerDecisions.answer", "decision-1", { kind: "single-choice", optionId: "yes" }, { projectId: "project-b" }],
      ["ownerDecisions.cancel", "decision-2", "stale", { projectId: "project-b" }],
      ["ownerQuestions.list", { status: "pending", projectId: "project-b" }],
      ["ownerQuestions.answer", "question-1", "yes", { projectId: "project-b" }],
      ["ownerQuestions.dismiss", "question-2", "stale", { projectId: "project-b" }],
    ]);
  });
});

describe("createScopeScopedKotaClient", () => {
  it("injects scopeId into representative scoped namespaces", async () => {
    const calls: unknown[] = [];
    const base = {
      forProject: () => {
        throw new Error("unexpected call");
      },
      forScope: () => {
        throw new Error("unexpected call");
      },
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
            agentConcurrency: 1,
            codeConcurrency: 4,
          };
        },
      },
      approvals: {
        list: async (filter: unknown) => {
          calls.push(["approvals.list", filter]);
          return { approvals: [] };
        },
      },
      ownerQuestions: {
        answer: async (id: string, answer: string, project: unknown) => {
          calls.push(["ownerQuestions.answer", id, answer, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
      memory: {
        list: async (filter: unknown) => {
          calls.push(["memory.list", filter]);
          return { entries: [] };
        },
      },
      tasks: {
        list: async (states: unknown, project: unknown) => {
          calls.push(["tasks.list", states, project]);
          return { tasks: [] };
        },
      },
    } as unknown as KotaClient;

    const scoped = createScopeScopedKotaClient(base, "scope-b");
    await scoped.workflow.status();
    await scoped.approvals.list({ status: "all" });
    await scoped.ownerQuestions.answer("question-1", "yes");
    await scoped.memory.list();
    await scoped.tasks.list(["ready"]);

    expect(calls).toEqual([
      ["workflow.status", { scopeId: "scope-b" }],
      ["approvals.list", { status: "all", scopeId: "scope-b" }],
      ["ownerQuestions.answer", "question-1", "yes", { scopeId: "scope-b" }],
      ["memory.list", { scopeId: "scope-b" }],
      ["tasks.list", ["ready"], { scopeId: "scope-b" }],
    ]);
  });

  it("rejects conflicting caller selectors before invoking the base namespace", async () => {
    const calls: unknown[] = [];
    const base = {
      forProject: () => {
        throw new Error("unexpected call");
      },
      forScope: () => {
        throw new Error("unexpected call");
      },
      approvals: {
        approve: async (
          id: string,
          reviewDigest: string,
          note: string | undefined,
          project: unknown,
        ) => {
          calls.push(["approvals.approve", id, reviewDigest, note, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
      },
    } as unknown as KotaClient;

    const scoped = createScopeScopedKotaClient(base, "scope-a");
    await expect(
      scoped.approvals.approve(
        "approval-1",
        "a".repeat(64),
        "ok",
        { projectId: "scope-b" },
      ),
    ).rejects.toBeInstanceOf(ScopeSelectorConflictError);
    expect(calls).toEqual([]);
  });
});
