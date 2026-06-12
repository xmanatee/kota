import { describe, expect, it } from "vitest";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowRunSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { KotaClient } from "#core/server/kota-client.js";
import type { ModuleSetupRequirementStatus } from "#modules/setup/client.js";
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
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "fresh", pid: 1234, baseURL: "http://127.0.0.1:8765" },
    ...overrides,
  };
}

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "a1b2c3d4",
    tool: "shell.exec",
    input: { cmd: "deploy" },
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
    scope: "project",
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
  approvals?: PendingApproval[];
  questions?: PendingOwnerQuestion[];
  blockedContent?: Record<string, string>;
  setup?: ModuleSetupRequirementStatus[];
  runs?: WorkflowRunSummary[];
} = {}): KotaClient {
  const blockedContent = args.blockedContent ?? {};
  return {
    forProject() {
      return this as KotaClient;
    },
    approvals: {
      async list() {
        return { approvals: args.approvals ?? [] };
      },
      async approve() {
        throw new Error("not used");
      },
      async reject() {
        throw new Error("not used");
      },
    },
    ownerQuestions: {
      async list() {
        return { questions: args.questions ?? [] };
      },
      async answer() {
        throw new Error("not used");
      },
      async dismiss() {
        throw new Error("not used");
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
      async move() {
        throw new Error("not used");
      },
      async create() {
        throw new Error("not used");
      },
      async capture() {
        throw new Error("not used");
      },
      async gc() {
        throw new Error("not used");
      },
      async search() {
        throw new Error("not used");
      },
      async reindex() {
        throw new Error("not used");
      },
    },
    setup: {
      async list() {
        return {
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
      async submitForm() {
        throw new Error("not used");
      },
      async storeSecret() {
        throw new Error("not used");
      },
      async start() {
        throw new Error("not used");
      },
      async complete() {
        throw new Error("not used");
      },
      async refresh() {
        throw new Error("not used");
      },
      async revoke() {
        throw new Error("not used");
      },
    },
    workflow: {
      async listRuns() {
        return { runs: args.runs ?? [] };
      },
    },
  } as unknown as KotaClient;
}

describe("operator inbox", () => {
  it("renders a clear inbox when no attention items exist", async () => {
    const snapshot = await buildOperatorInboxSnapshot({
      client: client(),
      projectDir: "/repo",
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
          "task-needs-owner": "## Unblock Precondition\n\nkind: owner-decision\nslot: product-priority\n",
        },
        setup: [setupRequirement()],
        runs: [failedRun()],
      }),
      projectDir: "/repo",
      status: status({
        daemonRunning: false,
        controlFile: { kind: "stale", pid: 99999, baseURL: "http://127.0.0.1:8765" },
        historicalWorkflow: {
          activeRuns: 0,
          queuedRuns: 2,
          workflowPaused: false,
        },
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

  it("fails when a listed blocked task has no typed unblock precondition", async () => {
    await expect(buildOperatorInboxSnapshot({
      client: client({
        blockedContent: {
          "task-malformed": "## Source / Intent\n\nNo unblock section.\n",
        },
      }),
      projectDir: "/repo",
      status: status(),
    })).rejects.toThrow(/missing typed unblock precondition/);
  });
});
