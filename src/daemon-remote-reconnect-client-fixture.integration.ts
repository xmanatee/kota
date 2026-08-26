import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import type {
  DaemonLiveStatus,
  DaemonSseStreamEvent,
  DaemonTimelineEvent,
  WorkflowRunDetail,
} from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { RunArtifacts } from "#modules/workflow-ops/routes/workflow-run-routes.js";

export const REMOTE_RECONNECT_TOKEN = "remote-reconnect-test-token";
export const REMOTE_RECONNECT_SCOPE_ID = "remote-reconnect-scope";
export const REMOTE_RECONNECT_STARTED_AT = "2026-05-16T02:10:00.000Z";
export const REMOTE_RECONNECT_RUN_ID = "2026-05-16T02-10-00-000Z-builder-reconn1";
export const REMOTE_RECONNECT_SESSION_ID = "session-remote-reconnect";

type SseStream = {
  readEvents(count: number): Promise<DaemonSseStreamEvent[]>;
  close(): Promise<void>;
};

export type RebuiltRemoteClientState = {
  activeSessionIds: string[];
  activeRunIds: string[];
  run: WorkflowRunDetail;
  approvals: ApprovalClientProjection[];
  ownerQuestions: PendingOwnerQuestion[];
  artifacts: RunArtifacts;
  timeline: DaemonTimelineEvent[];
};

export async function remoteReconnectFetch(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${REMOTE_RECONNECT_TOKEN}`);
  return fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

export async function remoteReconnectJson<T>(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await remoteReconnectFetch(port, path, options);
  expect(response.status, `${path} status`).toBe(200);
  return await response.json() as T;
}

export async function openRemoteReconnectSse(port: number, path: string): Promise<SseStream> {
  const controller = new AbortController();
  const response = await remoteReconnectFetch(port, path, { signal: controller.signal });
  expect(response.status, `${path} status`).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
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
      if (id && type && data) {
        events.push({ id, type, payload: JSON.parse(data) } as DaemonSseStreamEvent);
      }
    }
    return events;
  }

  return {
    async readEvents(count) {
      const events: DaemonSseStreamEvent[] = [];
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        while (events.length < count) {
          events.push(...parseMessages());
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
    async close() {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        // The abort path may have already closed the reader.
      }
    },
  };
}

export function writeRemoteReconnectRunArtifacts(scopeRoot: string): string {
  const runDir = join(scopeRoot, ".kota", "runs", REMOTE_RECONNECT_RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const metadata: WorkflowRunMetadata = {
    id: REMOTE_RECONNECT_RUN_ID,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "remote.reconnect.test",
      schemaRef: null,
      payload: { scopeId: REMOTE_RECONNECT_SCOPE_ID },
    },
    tags: ["remote-reconnect"],
    startedAt: REMOTE_RECONNECT_STARTED_AT,
    status: "running",
    runDir: `.kota/runs/${REMOTE_RECONNECT_RUN_ID}`,
    steps: [{
      id: "probe",
      type: "code",
      status: "success",
      startedAt: REMOTE_RECONNECT_STARTED_AT,
      completedAt: "2026-05-16T02:10:02.000Z",
      durationMs: 2_000,
      output: { artifact: "remote-client-reconnect/probe.json" },
    }],
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

export async function rebuildRemoteClientState(port: number): Promise<RebuiltRemoteClientState> {
  const status = await remoteReconnectJson<DaemonLiveStatus>(port, "/status");
  const run = await remoteReconnectJson<WorkflowRunDetail>(
    port,
    `/workflow/runs/${REMOTE_RECONNECT_RUN_ID}`,
  );
  const approvals = await remoteReconnectJson<{ approvals: ApprovalClientProjection[] }>(
    port,
    "/approvals?status=all",
  );
  const ownerQuestions = await remoteReconnectJson<{ questions: PendingOwnerQuestion[] }>(
    port,
    "/owner-questions?status=all",
  );
  const artifacts = await remoteReconnectJson<RunArtifacts>(
    port,
    `/api/workflow/runs/${REMOTE_RECONNECT_RUN_ID}/artifacts`,
  );
  const timeline = await remoteReconnectJson<{ events: DaemonTimelineEvent[] }>(
    port,
    "/api/events?limit=100",
  );
  return {
    activeSessionIds: status.sessions.map((session) => session.id),
    activeRunIds: status.workflow.activeRuns.map((run) => run.runId),
    run,
    approvals: approvals.approvals,
    ownerQuestions: ownerQuestions.questions,
    artifacts,
    timeline: timeline.events,
  };
}

export function eventIds(events: Array<{ id: string }>): string[] {
  return events.map((event) => event.id);
}

export function writeRemoteReconnectProbe(record: Record<string, unknown>): void {
  const dir = process.env.KOTA_REMOTE_RECONNECT_ARTIFACT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "probe.json"), JSON.stringify(record, null, 2));
}
