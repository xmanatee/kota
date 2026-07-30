import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import type { DaemonTimelineEvent } from "#core/daemon/daemon-control.js";
import { DaemonControlServer } from "#core/daemon/daemon-control.js";
import {
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
  setOwnerQuestionQueueInstance,
} from "#core/daemon/owner-question-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { approvalControlRoutes } from "#modules/approval-queue/routes.js";
import { ownerQuestionControlRoutes } from "#modules/owner-questions/routes.js";
import { workflowRoutes } from "#modules/workflow-ops/routes/routes.js";
import {
  eventIds,
  openRemoteReconnectSse,
  REMOTE_RECONNECT_PROJECT_ID as PROJECT_ID,
  REMOTE_RECONNECT_RUN_ID as RUN_ID,
  rebuildRemoteClientState,
  remoteReconnectFetch,
  remoteReconnectJson,
  REMOTE_RECONNECT_SESSION_ID as SESSION_ID,
  REMOTE_RECONNECT_STARTED_AT as STARTED_AT,
  REMOTE_RECONNECT_TOKEN as TOKEN,
  writeRemoteReconnectProbe,
  writeRemoteReconnectRunArtifacts,
} from "./daemon-remote-reconnect-client-fixture.integration.js";
import { makeRemoteReconnectHandle } from "./daemon-remote-reconnect-handle-fixture.integration.js";

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
    const projectBus = new ProjectScopedEventBus(bus, PROJECT_ID);
    writeRemoteReconnectRunArtifacts(projectDir);
    const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), projectBus);
    const ownerQuestionQueue = new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
      projectBus,
    );
    setApprovalQueueInstance(approvalQueue);
    setOwnerQuestionQueueInstance(ownerQuestionQueue);

    server = new DaemonControlServer(makeRemoteReconnectHandle(bus, projectDir), TOKEN, {
      controlRoutes: [...approvalControlRoutes(), ...ownerQuestionControlRoutes()],
      routes: workflowRoutes(),
    });
    const port = await server.start();

    const firstStream = await openRemoteReconnectSse(port, "/events");
    projectBus.emit("workflow.started", {
      workflow: "builder",
      runId: RUN_ID,
      triggerEvent: "remote.reconnect.test",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: `.kota/runs/${RUN_ID}`,
      startedAt: STARTED_AT,
      autonomyMode: "supervised",
    });
    projectBus.emit("session.registered", {
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
    const beforeReconnect = await rebuildRemoteClientState(port);
    const reviewedApproval = beforeReconnect.approvals.find((item) => item.id === approval.id);
    if (!reviewedApproval || reviewedApproval.review.status !== "available") {
      throw new Error("Expected the remote client to receive a reviewable approval");
    }

    expect(beforeReconnect.activeSessionIds).toEqual([SESSION_ID]);
    expect(beforeReconnect.activeRunIds).toEqual([RUN_ID]);
    expect(beforeReconnect.run.id).toBe(RUN_ID);
    expect(beforeReconnect.approvals.filter((item) => item.status === "pending")).toHaveLength(1);
    expect(beforeReconnect.ownerQuestions.filter((item) => item.status === "pending")).toHaveLength(1);
    expect(beforeReconnect.artifacts.textFiles).toContainEqual({
      name: "probe-output.txt",
      content: expect.stringContaining("remote reconnect probe"),
    });

    projectBus.emit("workflow.step.completed", {
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
    const answerResponse = await remoteReconnectFetch(
      port,
      `/owner-questions/${question.id}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "continue" }),
      },
    );
    expect(answerResponse.status).toBe(200);
    const approveResponse = await remoteReconnectFetch(
      port,
      `/approvals/${approval.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewDigest: reviewedApproval.review.digest,
          note: "approved by reconnect probe",
        }),
      },
    );
    expect(approveResponse.status).toBe(200);

    const reconnectStream = await openRemoteReconnectSse(
      port,
      `/events?after=${encodeURIComponent(lastSeenId)}`,
    );
    const reconnectEvents = await reconnectStream.readEvents(4);
    await reconnectStream.close();
    const afterReconnect = await rebuildRemoteClientState(port);
    const catchUp = await remoteReconnectJson<{ events: DaemonTimelineEvent[] }>(
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
    expect(afterReconnect.approvals.find((item) => item.id === approval.id)?.status).toBe("approved");
    expect(afterReconnect.ownerQuestions.find((item) => item.id === question.id)?.status).toBe("answered");
    expect(afterReconnect.artifacts.textFiles.map((file) => file.name)).toContain("probe-output.txt");
    expect(new Set(eventIds(afterReconnect.timeline)).size).toBe(afterReconnect.timeline.length);

    writeRemoteReconnectProbe({
      daemonBoot: { port, projectDir },
      disconnectedAfterEventId: lastSeenId,
      firstStream: firstEvents.map((event) => ({ id: event.id, type: event.type })),
      reconnectStream: reconnectEvents.map((event) => ({ id: event.id, type: event.type })),
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
