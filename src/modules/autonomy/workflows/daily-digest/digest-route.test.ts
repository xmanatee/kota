import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scheduler } from "#core/daemon/scheduler.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { buildRequestHandler } from "#core/server/server-routes.js";
import { SessionPool } from "#core/server/session-pool.js";
import { digestRoutes } from "./digest-route.js";
import {
  DAILY_DIGEST_STATE_FILENAME,
  renderOnDemandDigest,
} from "./on-demand.js";

vi.mock("#core/daemon/owner-question-queue.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("#core/daemon/owner-question-queue.js")
    >("#core/daemon/owner-question-queue.js");
  let queue: InstanceType<typeof actual.OwnerQuestionQueue> | null = null;
  return {
    ...actual,
    getOwnerQuestionQueue: (dir?: string) => {
      if (!queue) {
        queue = new actual.OwnerQuestionQueue(
          dir ?? join(process.cwd(), ".kota", "owner-questions"),
        );
      }
      return queue;
    },
    resetOwnerQuestionQueue: () => {
      queue = null;
    },
  };
});

const TOKEN = "digest-route-test-token";

describe("GET /api/digest", () => {
  let projectDir: string;
  let server: Server;
  let baseUrl: string;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-digest-route-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "blocked"), { recursive: true });

    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.daily.digest", payload });
    };
    unsubscribe = bus.on("workflow.daily.digest", handler as never);

    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    ownerMod.getOwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));

    const pool = new SessionPool();
    const requestHandler = buildRequestHandler({
      port: 0,
      pool,
      scheduler: { count: () => 0 } as unknown as Scheduler,
      bus,
      moduleRoutes: digestRoutes({ projectDir }),
      makeAgent: () => {
        throw new Error("makeAgent should not be invoked by /api/digest tests");
      },
      resolveDefaultAutonomyMode: () => "passive",
      authToken: TOKEN,
    });
    server = createServer(requestHandler);
    await new Promise<void>((res) => {
      server.listen(0, "127.0.0.1", res);
    });
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    unsubscribe?.();
    resetEventBus();
    await new Promise<void>((res) => {
      server.close(() => res());
    });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns the same body and structured payload renderOnDemandDigest produces", async () => {
    const windowEndMs = Date.parse("2026-04-26T03:30:00.000Z");
    const expected = renderOnDemandDigest({ projectDir, windowEndMs });

    const res = await fetch(`${baseUrl}/api/digest?windowEndMs=${windowEndMs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: typeof expected.data; text: string };
    expect(body.text).toBe(expected.text);
    expect(body.data).toEqual(expected.data);
    expect(body.data.quiet).toBe(true);
  });

  it("does not write the cadence snapshot or emit workflow.daily.digest", async () => {
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    expect(existsSync(statePath)).toBe(false);

    const res = await fetch(`${baseUrl}/api/digest`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    expect(existsSync(statePath)).toBe(false);
    expect(observed).toEqual([]);
  });

  it("rejects requests without the bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/digest`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric windowEndMs query parameter", async () => {
    const res = await fetch(`${baseUrl}/api/digest?windowEndMs=not-a-number`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(400);
  });
});
