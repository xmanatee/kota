import { describe, expect, it } from "vitest";
import type {
  ApprovalClientProjection,
} from "#core/daemon/approval-queue.js";
import type { WorkflowRunSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import type { ModuleSetupRequirementStatus } from "#modules/setup/client.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
  buildOperatorInboxSnapshot,
} from "./operator-inbox.js";
import { formatOperatorInboxOutput } from "./operator-inbox-render.js";
import type { StatusSnapshot } from "./status-cli.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: true,
    daemonPid: 1234,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    scopeRoot: "/repo",
    scopeName: "repo",
    controlFile: { kind: "fresh", pid: 1234, baseURL: "http://127.0.0.1:8765" },
    runProjection: {
      available: true,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [],
    },
    ...overrides,
  };
}

function approval(
  overrides: Partial<ApprovalClientProjection> = {},
): ApprovalClientProjection {
  return {
    id: "a1b2c3d4",
    scopeId: "scope-test",
    kind: "tool_call",
    tool: "shell.exec",
    input: { cmd: "deploy" },
    review: {
      status: "available",
      input: { command: "deploy" },
      digest: "a".repeat(64),
    },
    risk: "dangerous",
    reason: "external write",
    createdAt: "2026-06-11T12:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function ownerQuestion(overrides: Partial<PendingOwnerQuestion> = {}): PendingOwnerQuestion {
  return {
    id: "q1",
    seq: 1,
    context: "Need owner decision.",
    question: "Should KOTA run the migration?",
    reason: "The workflow cannot safely infer the answer.",
    source: "builder",
    answerBehavior: "workflow-resume",
    origin: {
      kind: "workflow",
      workflowName: "builder",
      runId: "run-1",
      stepId: "ask-owner",
      taskId: "task-x",
    },
    createdAt: "2026-06-11T12:05:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function setupRequirement(
  overrides: Partial<ModuleSetupRequirementStatus> = {},
): ModuleSetupRequirementStatus {
  return {
    moduleName: "github",
    requirementId: "token",
    kind: "secret",
    title: "GitHub token",
    required: true,
    scope: "scope",
    sensitivity: "secret",
    setup: { mode: "form", fields: [] },
    state: "missing",
    reason: "secret_missing",
    message: "GitHub token is missing.",
    ...overrides,
  };
}

function failedRun(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: "2026-06-11T12-00-00-000Z-builder-fail",
    workflow: "builder",
    status: "failed",
    triggerEvent: "manual",
    triggerSchemaRef: null,
    startedAt: "2026-06-11T12:00:00.000Z",
    ...overrides,
  };
}

function client(args: {
  approvals?: ApprovalClientProjection[];
  questions?: PendingOwnerQuestion[];
  blockedContent?: Record<string, string>;
  setup?: ModuleSetupRequirementStatus[];
  setupVisibility?: "hidden" | "metadata" | "full";
  runs?: WorkflowRunSummary[];
} = {}): KotaClient {
  const blockedContent = args.blockedContent ?? {};
  return createKotaClientTestDouble({
    approvals: {
      async list() {
        return { approvals: args.approvals ?? [] };
      },
    },
    ownerQuestions: {
      async list() {
        return { questions: args.questions ?? [] };
      },
    },
    tasks: {
      async list(states?: string[]) {
        if (!states?.includes("blocked")) return { tasks: [] };
        return {
          tasks: Object.keys(blockedContent).map((id) => ({
            id,
            title: `Blocked ${id}`,
            state: "blocked" as const,
            priority: "p1",
            waitingOnTasks: [],
          })),
        };
      },
      async show(id: string) {
        const content = blockedContent[id];
        return content ? { found: true as const, state: "blocked" as const, content } : { found: false as const };
      },
    },
    setup: {
      async list() {
        return {
          visibility: args.setupVisibility ?? "full",
          requirements: args.setup ?? [],
          summary: {
            ready: 0,
            missing: args.setup?.filter((req) => req.state === "missing").length ?? 0,
            pending: 0,
            expired: 0,
            revoked: 0,
            unknown: 0,
            unavailable: 0,
          },
        };
      },
    },
    workflow: {
      async listRuns() {
        return { runs: args.runs ?? [] };
      },
    },
  });
}

describe("operator inbox", () => {
  it("renders a clear inbox when no attention items exist", async () => {
    const snapshot = await buildOperatorInboxSnapshot({
      client: client(),
      scopeRoot: "/repo",
      status: status(),
    });
    expect(snapshot.items).toHaveLength(0);
    const output = formatOperatorInboxOutput(snapshot);
    expect(output).toContain("Operator inbox is clear");
  });

  it("aggregates runtime warnings, approvals, owner questions, blocked tasks, setup gaps, and failed runs", async () => {
    const snapshot = await buildOperatorInboxSnapshot({
      client: client({
        approvals: [approval()],
        questions: [ownerQuestion()],
        blockedContent: {
          "task-needs-owner": "## Blocked on\n\nkind: owner-decision\nslot: product-priority\n",
        },
        setup: [setupRequirement()],
        runs: [failedRun()],
      }),
      scopeRoot: "/repo",
      status: status({
        daemonRunning: false,
        controlFile: { kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" },
        queuedRuns: 2,
      }),
    });

    expect(snapshot.counts.runtime).toBe(3);
    expect(snapshot.counts.approval).toBe(1);
    expect(snapshot.counts["owner-question"]).toBe(1);
    expect(snapshot.counts["blocked-task"]).toBe(1);
    expect(snapshot.counts.setup).toBe(1);
    expect(snapshot.counts["failed-run"]).toBe(1);

    const output = formatOperatorInboxOutput(snapshot);
    expect(output).toContain("Operator inbox");
    expect(output).toContain("Daemon is offline");
    expect(output).toContain("Approval required: shell.exec");
    expect(output).toContain("Should KOTA run the migration?");
    expect(output).toContain("Blocked task-needs-owner");
    expect(output).toContain("github: GitHub token");
    expect(output).toContain("builder failed");
  });

  it("surfaces hidden setup visibility without inventing requirement rows", async () => {
    const snapshot = await buildOperatorInboxSnapshot({
      client: client({ setupVisibility: "hidden" }),
      scopeRoot: "/repo",
      status: status(),
    });

    expect(snapshot.counts.setup).toBe(1);
    expect(formatOperatorInboxOutput(snapshot)).toContain(
      "Setup requirements hidden by scope policy",
    );
  });

  it("fails when a listed blocked task has no typed unblock precondition", async () => {
    await expect(buildOperatorInboxSnapshot({
      client: client({
        blockedContent: {
          "task-malformed": "## Source / Intent\n\nNo unblock section.\n",
        },
      }),
      scopeRoot: "/repo",
      status: status(),
    })).rejects.toThrow(/missing typed unblock precondition/);
  });
});
