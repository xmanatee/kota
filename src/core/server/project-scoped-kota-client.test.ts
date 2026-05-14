import { describe, expect, it } from "vitest";
import type { KotaClient } from "./kota-client.js";
import { createProjectScopedKotaClient } from "./project-scoped-kota-client.js";

describe("createProjectScopedKotaClient", () => {
  it("injects projectId into approvals and ownerQuestions namespaces", async () => {
    const calls: unknown[] = [];
    const base = {
      forProject: () => {
        throw new Error("not used");
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
        approve: async (id: string, note: string | undefined, project: unknown) => {
          calls.push(["approvals.approve", id, note, project]);
          return { ok: false as const, reason: "not_found" as const };
        },
        reject: async (id: string, reason: string | undefined, project: unknown) => {
          calls.push(["approvals.reject", id, reason, project]);
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
    await scoped.approvals.list({ status: "all" });
    await scoped.approvals.approve("approval-1", "ok");
    await scoped.approvals.reject("approval-2", "no");
    await scoped.ownerQuestions.list({ status: "pending" });
    await scoped.ownerQuestions.answer("question-1", "yes");
    await scoped.ownerQuestions.dismiss("question-2", "stale");

    expect(calls).toEqual([
      ["workflow.status", { projectId: "project-b" }],
      ["approvals.list", { status: "all", projectId: "project-b" }],
      ["approvals.approve", "approval-1", "ok", { projectId: "project-b" }],
      ["approvals.reject", "approval-2", "no", { projectId: "project-b" }],
      ["ownerQuestions.list", { status: "pending", projectId: "project-b" }],
      ["ownerQuestions.answer", "question-1", "yes", { projectId: "project-b" }],
      ["ownerQuestions.dismiss", "question-2", "stale", { projectId: "project-b" }],
    ]);
  });
});
