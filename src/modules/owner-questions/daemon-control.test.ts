/**
 * Exercises the owner-questions module's daemon-control routes through the
 * same registration seam the real daemon uses: `ownerQuestionControlRoutes()`
 * is the module's contribution, so the test mounts those handlers on a live
 * `DaemonControlServer` and hits `GET /owner-questions`,
 * `POST /owner-questions/:id/answer`, and
 * `POST /owner-questions/:id/dismiss` via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `read` / `control` capability-scope split (the GET is read-only, the two
 * POSTs require control), `{ questions: PendingOwnerQuestion[] }` envelope on
 * list, `{ question: PendingOwnerQuestion }` envelope on individual
 * transitions, `400 { error: "answer is required" }` on missing answer, and
 * `404 { error: "Owner question not found or already resolved" }` on missing
 * or already-resolved items.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import {
  getOwnerQuestionQueue,
  type OwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import { ownerQuestionControlRoutes } from "./routes.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
  getEventBus: () => null,
}));

const TEST_TOKEN = "owner-questions-test-token";

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    })),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
  };
}

async function fetchWith(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...init.headers },
  });
}

function seed(queue: OwnerQuestionQueue) {
  return queue.enqueue({
    context: "Working on the escalation flow for autonomous runs.",
    question: "Should the timeout default to 10 minutes or 1 hour?",
    reason: "The default affects how long workflow steps block on owner input.",
    source: "session",
  });
}

describe("owner-questions module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let queueDir: string;
  let queue: OwnerQuestionQueue;

  beforeEach(async () => {
    queueDir = mkdtempSync(join(tmpdir(), "kota-owner-questions-control-"));
    resetOwnerQuestionQueue();
    // The control-route handlers resolve the queue through
    // getOwnerQuestionQueue(); pin that singleton to our temp dir so the test
    // and the handlers see the same backing files.
    queue = getOwnerQuestionQueue(queueDir);
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: ownerQuestionControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetOwnerQuestionQueue();
    rmSync(queueDir, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares /owner-questions routes with read/control capability scopes", () => {
      const routes = ownerQuestionControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "GET /owner-questions (read)",
        "POST /owner-questions/:id/answer (control)",
        "POST /owner-questions/:id/dismiss (control)",
      ]);
    });

    it("requires the daemon bearer token on all three routes", async () => {
      for (const init of [
        { path: "/owner-questions", method: "GET" },
        { path: "/owner-questions/anything/answer", method: "POST" },
        { path: "/owner-questions/anything/dismiss", method: "POST" },
      ]) {
        const res = await globalThis.fetch(`http://127.0.0.1:${port}${init.path}`, {
          method: init.method,
        });
        expect(res.status).toBe(401);
      }
    });
  });

  describe("GET /owner-questions", () => {
    it("returns 200 with empty list when no pending questions exist", async () => {
      const res = await fetchWith(port, "/owner-questions");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ questions: [] });
    });

    it("returns pending questions from the queue", async () => {
      seed(queue);
      const second = queue.enqueue({
        context: "Another run wants permission to publish a release.",
        question: "Should I tag this commit as v2?",
        reason: "User-visible release tag should not be set without owner sign-off.",
        source: "release-bot",
      });

      const res = await fetchWith(port, "/owner-questions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { questions: Array<{ id: string; status: string }> };
      expect(body.questions).toHaveLength(2);
      expect(body.questions.every((q) => q.status === "pending")).toBe(true);
      expect(body.questions.map((q) => q.id)).toContain(second.id);
    });

    it("excludes resolved questions", async () => {
      const item = seed(queue);
      queue.answer(item.id, "10 minutes", "http");

      const res = await fetchWith(port, "/owner-questions");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ questions: [] });
    });
  });

  describe("POST /owner-questions/:id/answer", () => {
    it("answers a pending question and returns it", async () => {
      const item = seed(queue);
      const res = await fetchWith(port, `/owner-questions/${item.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "10 minutes" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { question: { id: string; status: string; answer: string; resolutionSource?: string } };
      expect(body.question.id).toBe(item.id);
      expect(body.question.status).toBe("answered");
      expect(body.question.answer).toBe("10 minutes");
      expect(body.question.resolutionSource).toBe("http");
    });

    it("returns 400 when the answer field is missing or whitespace", async () => {
      const item = seed(queue);

      for (const body of [{}, { answer: "" }, { answer: "   " }]) {
        const res = await fetchWith(port, `/owner-questions/${item.id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "answer is required" });
      }
      // Item still pending after the 400s.
      expect(queue.get(item.id)?.status).toBe("pending");
    });

    it("returns 404 when the question is missing", async () => {
      const res = await fetchWith(port, "/owner-questions/missing/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "x" }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Owner question not found or already resolved" });
    });

    it("returns 404 when the question is no longer pending", async () => {
      const item = seed(queue);
      queue.answer(item.id, "first answer", "http");

      const res = await fetchWith(port, `/owner-questions/${item.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "again" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /owner-questions/:id/dismiss", () => {
    it("dismisses a pending question with a reason and returns it", async () => {
      const item = seed(queue);

      const res = await fetchWith(port, `/owner-questions/${item.id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "scope changed" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { question: { id: string; status: string; dismissalReason?: string; resolutionSource?: string } };
      expect(body.question.id).toBe(item.id);
      expect(body.question.status).toBe("dismissed");
      expect(body.question.dismissalReason).toBe("scope changed");
      expect(body.question.resolutionSource).toBe("http");
    });

    it("dismisses without a reason when the body omits it", async () => {
      const item = seed(queue);

      const res = await fetchWith(port, `/owner-questions/${item.id}/dismiss`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { question: { status: string; dismissalReason?: string } };
      expect(body.question.status).toBe("dismissed");
      expect(body.question.dismissalReason).toBeUndefined();
    });

    it("returns 404 when the question is missing", async () => {
      const res = await fetchWith(port, "/owner-questions/missing/dismiss", { method: "POST" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Owner question not found or already resolved" });
    });

    it("returns 404 when the question is no longer pending", async () => {
      const item = seed(queue);
      queue.dismiss(item.id, "already done", "http");

      const res = await fetchWith(port, `/owner-questions/${item.id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "again" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("capability scope", () => {
    it("rejects mutating routes when the bearer token is absent (control scope still requires auth)", async () => {
      const item = seed(queue);

      const noAuth = await globalThis.fetch(`http://127.0.0.1:${port}/owner-questions/${item.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "yes" }),
      });
      expect(noAuth.status).toBe(401);
      // The item is still pending after the unauthorized request.
      expect(queue.get(item.id)?.status).toBe("pending");
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", async () => {
      const collision = [
        ...ownerQuestionControlRoutes(),
        {
          method: "GET" as const,
          path: "/owner-questions",
          capabilityScope: "read" as const,
          handler: (_req: unknown, res: { writeHead: (s: number) => void; end: () => void }) => {
            res.writeHead(500);
            res.end();
          },
        },
      ];
      expect(
        () =>
          new DaemonControlServer(makeHandle(), TEST_TOKEN, {
            controlRoutes: collision as never,
          }),
      ).toThrow(/collides/);
    });
  });
});
