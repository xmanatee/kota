import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { ApprovalQueue, resetApprovalQueue, setApprovalQueueInstance } from "#core/daemon/approval-queue.js";
import type {
  DaemonControlHandle,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseStreamEvent,
  DaemonTimelineEvent,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import { DaemonControlServer } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { OwnerQuestionQueue, resetOwnerQuestionQueue, setOwnerQuestionQueueInstance } from "#core/daemon/owner-question-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { approvalControlRoutes } from "#modules/approval-queue/routes.js";
import { ownerQuestionControlRoutes } from "#modules/owner-questions/routes.js";
import { workflowRoutes } from "#modules/workflow-ops/routes/routes.js";
import type { RunArtifacts } from "#modules/workflow-ops/routes/workflow-run-routes.js";

const TOKEN = "remote-reconnect-test-token";
const PROJECT_ID = "remote-reconnect-project";
const STARTED_AT = "2026-05-16T02:10:00.000Z";
const RUN_ID = "2026-05-16T02-10-00-000Z-builder-reconn1";
const SESSION_ID = "session-remote-reconnect";

type SseStream = {
  readEvents(count: number): Promise<DaemonSseStreamEvent[]>;
  close(): Promise<void>;
};

type RebuiltClientState = {
  activeSessionIds: string[];
  activeRunIds: string[];
  run: WorkflowRunDetail;
  approvals: PendingApproval[];
  ownerQuestions: PendingOwnerQuestion[];
  artifacts: RunArtifacts;
  timeline: DaemonTimelineEvent[];
};

async function fetchWithToken(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  return fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

async function fetchJson<T>(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetchWithToken(port, path, options);
  expect(res.status, `${path} status`).toBe(200);
  return await res.json() as T;
}

async function openSse(port: number, path: string): Promise<SseStream> {
  const controller = new AbortController();
  const res = await fetchWithToken(port, path, { signal: controller.signal });
  expect(res.status, `${path} status`).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseMessages(): DaemonSseStreamEvent[] {
    const events: DaemonSseStreamEvent[] = [];
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      if (!message.trim() || message.startsWith(":")) continue;
      let id = "";
      let type = "";
      let data = "";
      for (const line of message.split("\n")) {
        if (line.startsWith("id: ")) id = line.slice(4).trim();
        else if (line.startsWith("event: ")) type = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6).trim();
      }
      if (!id || !type || !data) continue;
      events.push({ id, type, payload: JSON.parse(data) } as DaemonSseStreamEvent);
    }
    return events;
  }

  return {
    async readEvents(count: number): Promise<DaemonSseStreamEvent[]> {
      const events: DaemonSseStreamEvent[] = [];
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        while (events.length < count) {
          const parsed = parseMessages();
          events.push(...parsed);
          if (events.length >= count) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        return events.slice(0, count);
      } finally {
        clearTimeout(timeout);
      }
    },
    async close(): Promise<void> {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        // The abort path may have already closed the reader.
      }
    },
  };
}

function writeRunArtifacts(projectDir: string): string {
  const runDir = join(projectDir, ".kota", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const metadata: WorkflowRunMetadata = {
    id: RUN_ID,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "remote.reconnect.test", payload: { projectId: PROJECT_ID } },
    tags: ["remote-reconnect"],
    startedAt: STARTED_AT,
    status: "running",
    runDir: `.kota/runs/${RUN_ID}`,
    steps: [
      {
        id: "probe",
        type: "code",
        status: "success",
        startedAt: STARTED_AT,
        completedAt: "2026-05-16T02:10:02.000Z",
        durationMs: 2_000,
        output: { artifact: "remote-client-reconnect/probe.json" },
      },
    ],
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(runDir, "probe-output.txt"),
    [
      "remote reconnect probe",
      "stream disconnected after owner-question and approval events",
      "reconnected with an event id cursor",
    ].join("\n"),
  );
  return runDir;
}

function makeHandle(
  bus: EventBus,
  projectDir: string,
): DaemonControlHandle {
  const workflowRun: WorkflowRunDetail = {
    id: RUN_ID,
    workflow: "builder",
    status: "running",
    triggerEvent: "remote.reconnect.test",
    startedAt: STARTED_AT,
    tags: ["remote-reconnect"],
    steps: [
      {
        id: "probe",
        type: "code",
        status: "success",
        durationMs: 2_000,
      },
    ],
  };
  const workflowSummary: WorkflowRunSummary = {
    id: RUN_ID,
    workflow: "builder",
    status: "running",
    triggerEvent: "remote.reconnect.test",
    startedAt: STARTED_AT,
    tags: ["remote-reconnect"],
  };
  const workflowStatus: WorkflowLiveStatus = {
    activeRuns: [{ runId: RUN_ID, workflow: "builder", startedAt: STARTED_AT }],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {
      builder: { lastStarted: { runId: RUN_ID, startedAt: STARTED_AT } },
    },
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
  const sessions = [
    {
      id: SESSION_ID,
      createdAt: STARTED_AT,
      lastActive: new Date(STARTED_AT).getTime(),
      autonomyMode: "supervised" as const,
    },
  ];

  return {
    getDaemonLiveState: () => ({
      startedAt: STARTED_AT,
      completedRuns: 0,
      pid: 1,
      running: true,
    }),
    getHealthStatus: () => ({ scheduler: "ok", modules: "ok" }),
    getWorkflowLiveStatus: () => workflowStatus,
    listChannelStatuses: () => [],
    pauseWorkflowDispatch: () => ({ already: false }),
    resumeWorkflowDispatch: () => ({ already: false }),
    abortActiveRuns: () => ({ aborted: 0 }),
    abortActiveRun: () => ({ ok: false, notFound: true }),
    reloadWorkflowDefinitions: () => ({ count: 1 }),
    reloadConfig: async () => ({ workflows: 1, changedModules: [] }),
    getWorkflowDefinitions: () => [],
    enableWorkflow: () => ({ ok: true }),
    disableWorkflow: () => ({ ok: true }),
    enqueuePendingRun: () => ({ ok: true, queued: "builder", runId: RUN_ID }),
    cancelQueuedRun: () => ({ ok: false, active: true }),
    subscribeToEvents: (handler: (event: DaemonSseEvent) => void) => {
      const stops = [
        bus.on("workflow.started", (payload) => {
          handler({ type: "workflow.started", payload });
          handler({
            type: "queue.changed",
            payload: { source: "workflow.started", workflow: payload.workflow },
          });
        }),
        bus.on("workflow.step.completed", (payload) =>
          handler({ type: "workflow.step.completed", payload }),
        ),
        bus.on("approval.changed", (payload) =>
          handler({ type: "approval.changed", payload }),
        ),
        bus.on("session.registered", (payload) =>
          handler({ type: "session.registered", payload }),
        ),
        bus.on("owner.question.asked", (payload) =>
          handler({ type: "owner.question.asked", payload }),
        ),
        bus.on("owner.question.changed", (payload) =>
          handler({ type: "owner.question.changed", payload }),
        ),
        bus.on("owner.question.resolved", (payload) =>
          handler({ type: "owner.question.resolved", payload }),
        ),
      ];
      return () => stops.forEach((stop) => stop());
    },
    listWorkflowRuns: () => [workflowSummary],
    getWorkflowRun: (id: string) => (id === RUN_ID ? workflowRun : null),
    getWorkflowMetricCounts: () => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
    }),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getClientIdentity: async () => ({
      projectName: "remote-reconnect",
      projectDir,
      projects: {
        defaultProjectId: PROJECT_ID,
        projects: [
          {
            projectId: PROJECT_ID,
            projectDir,
            displayName: "remote-reconnect",
          },
        ],
      },
      daemonVersion: "0.1.0",
      pid: 1,
      startedAt: STARTED_AT,
      dashboard: {
        available: false,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    }),
    getProjectRegistryProjection: () => ({
      defaultProjectId: PROJECT_ID,
      projects: [
        {
          projectId: PROJECT_ID,
          projectDir,
          displayName: "remote-reconnect",
        },
      ],
    }),
    hasProject: (projectId: string) => projectId === PROJECT_ID,
    getActiveProjectId: () => null,
    setActiveProjectId: (projectId) =>
      projectId === null || projectId === PROJECT_ID
        ? { ok: true, activeProjectId: projectId }
        : { ok: false, reason: "not_found", projectId },
    registerSession: () => undefined,
    unregisterSession: () => undefined,
    listSessions: () => sessions,
    setSessionAutonomyMode: () => ({ ok: true }),
  };
}

async function rebuildClientState(port: number): Promise<RebuiltClientState> {
  const status = await fetchJson<DaemonLiveStatus>(port, "/status");
  const run = await fetchJson<WorkflowRunDetail>(port, `/workflow/runs/${RUN_ID}`);
  const approvals = await fetchJson<{ approvals: PendingApproval[] }>(
    port,
    "/approvals?status=all",
  );
  const ownerQuestions = await fetchJson<{ questions: PendingOwnerQuestion[] }>(
    port,
    "/owner-questions?status=all",
  );
  const artifacts = await fetchJson<RunArtifacts>(
    port,
    `/api/workflow/runs/${RUN_ID}/artifacts`,
  );
  const timeline = await fetchJson<{ events: DaemonTimelineEvent[] }>(
    port,
    "/api/events?limit=100",
  );

  return {
    activeSessionIds: status.sessions.map((session) => session.id),
    activeRunIds: status.workflow.activeRuns.map((runRef) => runRef.runId),
    run,
    approvals: approvals.approvals,
    ownerQuestions: ownerQuestions.questions,
    artifacts,
    timeline: timeline.events,
  };
}

function eventIds(events: Array<{ id: string }>): string[] {
  return events.map((event) => event.id);
}

function writeProbeArtifact(record: Record<string, unknown>): void {
  const dir = process.env.KOTA_REMOTE_RECONNECT_ARTIFACT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "probe.json"), JSON.stringify(record, null, 2));
}

describe("daemon remote-client reconnect contract", () => {
  let projectDir: string;
  let originalCwd: string;
  let server: DaemonControlServer | null = null;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectDir = mkdtempSync(join(tmpdir(), "kota-remote-reconnect-"));
    process.chdir(projectDir);
    resetApprovalQueue();
    resetOwnerQuestionQueue();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    resetApprovalQueue();
    resetOwnerQuestionQueue();
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rebuilds sessions, workflow run, decisions, artifacts, and timeline after SSE reconnect", async () => {
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, PROJECT_ID);
    writeRunArtifacts(projectDir);
    const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus);
    const ownerQuestionQueue = new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
      pbus,
    );
    setApprovalQueueInstance(approvalQueue);
    setOwnerQuestionQueueInstance(ownerQuestionQueue);

    server = new DaemonControlServer(makeHandle(bus, projectDir), TOKEN, {
      controlRoutes: [...approvalControlRoutes(), ...ownerQuestionControlRoutes()],
      routes: workflowRoutes(),
    });
    const port = await server.start();

    const firstStream = await openSse(port, "/events");
    pbus.emit("workflow.started", {
      workflow: "builder",
      runId: RUN_ID,
      triggerEvent: "remote.reconnect.test",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: `.kota/runs/${RUN_ID}`,
      startedAt: STARTED_AT,
      autonomyMode: "supervised",
    });
    bus.emit("session.registered", {
      id: SESSION_ID,
      createdAt: STARTED_AT,
      autonomyMode: "supervised",
    });
    const approval = approvalQueue.enqueue(
      "shell",
      { command: "pnpm test src/daemon-remote-reconnect.integration.test.ts" },
      "moderate",
      "remote client must surface pending tool approval",
      RUN_ID,
    );
    const question = ownerQuestionQueue.enqueue({
      context: "Remote client reconnect probe",
      question: "Should the waiting client continue after reconnect?",
      reason: "The probe must prove owner-input state survives stream reconnect.",
      source: RUN_ID,
      answerBehavior: "record-only",
      origin: { kind: "manual", source: RUN_ID },
      proposedAnswers: ["continue", "stop"],
    });

    const firstEvents = await firstStream.readEvents(6);
    await firstStream.close();
    const lastSeenId = firstEvents.at(-1)!.id;
    const beforeReconnect = await rebuildClientState(port);

    expect(beforeReconnect.activeSessionIds).toEqual([SESSION_ID]);
    expect(beforeReconnect.activeRunIds).toEqual([RUN_ID]);
    expect(beforeReconnect.run.id).toBe(RUN_ID);
    expect(beforeReconnect.approvals.filter((item) => item.status === "pending"))
      .toHaveLength(1);
    expect(beforeReconnect.ownerQuestions.filter((item) => item.status === "pending"))
      .toHaveLength(1);
    expect(beforeReconnect.artifacts.textFiles).toContainEqual({
      name: "probe-output.txt",
      content: expect.stringContaining("remote reconnect probe"),
    });

    pbus.emit("workflow.step.completed", {
      workflow: "builder",
      runId: RUN_ID,
      stepId: "probe",
      stepType: "code",
      status: "success",
      durationMs: 2_000,
      runDir: `.kota/runs/${RUN_ID}`,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      autonomyMode: "supervised",
    });
    const answerRes = await fetchWithToken(
      port,
      `/owner-questions/${question.id}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "continue" }),
      },
    );
    expect(answerRes.status).toBe(200);
    const approveRes = await fetchWithToken(
      port,
      `/approvals/${approval.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "approved by reconnect probe" }),
      },
    );
    expect(approveRes.status).toBe(200);

    const reconnectStream = await openSse(
      port,
      `/events?after=${encodeURIComponent(lastSeenId)}`,
    );
    const reconnectEvents = await reconnectStream.readEvents(4);
    await reconnectStream.close();
    const afterReconnect = await rebuildClientState(port);
    const catchUp = await fetchJson<{ events: DaemonTimelineEvent[] }>(
      port,
      `/api/events?after=${encodeURIComponent(lastSeenId)}`,
    );

    expect(reconnectEvents.map((event) => event.type)).toEqual([
      "workflow.step.completed",
      "owner.question.resolved",
      "owner.question.changed",
      "approval.changed",
    ]);
    expect(eventIds(reconnectEvents)).toEqual(eventIds(catchUp.events));
    expect(new Set([...eventIds(firstEvents), ...eventIds(reconnectEvents)]).size)
      .toBe(firstEvents.length + reconnectEvents.length);
    expect(reconnectEvents).not.toContainEqual(expect.objectContaining({ id: lastSeenId }));
    expect(afterReconnect.activeSessionIds).toEqual(beforeReconnect.activeSessionIds);
    expect(afterReconnect.activeRunIds).toEqual(beforeReconnect.activeRunIds);
    expect(afterReconnect.run.id).toBe(beforeReconnect.run.id);
    expect(afterReconnect.approvals.find((item) => item.id === approval.id)?.status)
      .toBe("approved");
    expect(afterReconnect.ownerQuestions.find((item) => item.id === question.id)?.status)
      .toBe("answered");
    expect(afterReconnect.artifacts.textFiles.map((file) => file.name))
      .toContain("probe-output.txt");
    expect(new Set(eventIds(afterReconnect.timeline)).size).toBe(
      afterReconnect.timeline.length,
    );

    writeProbeArtifact({
      daemonBoot: { port, projectDir },
      disconnectedAfterEventId: lastSeenId,
      firstStream: firstEvents.map((event) => ({ id: event.id, type: event.type })),
      reconnectStream: reconnectEvents.map((event) => ({
        id: event.id,
        type: event.type,
      })),
      activeSessionIds: afterReconnect.activeSessionIds,
      activeRunIds: afterReconnect.activeRunIds,
      approvalStatus: afterReconnect.approvals.find((item) => item.id === approval.id)?.status,
      ownerQuestionStatus: afterReconnect.ownerQuestions.find((item) => item.id === question.id)?.status,
      artifactNames: afterReconnect.artifacts.textFiles.map((file) => file.name),
      timelineIds: eventIds(afterReconnect.timeline),
      skippedDependencies: [],
    });
  });
});
