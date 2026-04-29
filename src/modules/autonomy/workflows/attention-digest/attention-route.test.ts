import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scheduler } from "#core/daemon/scheduler.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { buildRequestHandler } from "#core/server/server-routes.js";
import { SessionPool } from "#core/server/session-pool.js";
import { attentionRoutes } from "./attention-route.js";
import { renderOnDemandAttention } from "./step.js";

const TOKEN = "attention-route-test-token";

function makeTaskDir(projectDir: string, state: string, count: number): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `task-test-${i}.md`), `# task ${i}\n`, "utf-8");
  }
}

describe("GET /api/attention", () => {
  let projectDir: string;
  let runsDir: string;
  let server: Server;
  let baseUrl: string;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-attention-route-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    // Seed enough state that detector returns at least one attention item so
    // we can compare a non-trivial body and prove items[] is populated.
    makeTaskDir(projectDir, "doing", 2);
    makeTaskDir(projectDir, "ready", 1);
    makeTaskDir(projectDir, "backlog", 1);

    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.attention.digest", payload });
    };
    unsubscribe = bus.on("workflow.attention.digest", handler as never);

    const pool = new SessionPool();
    const requestHandler = buildRequestHandler({
      port: 0,
      pool,
      scheduler: { count: () => 0 } as unknown as Scheduler,
      bus,
      moduleRoutes: attentionRoutes({ projectDir }),
      makeAgent: () => {
        throw new Error(
          "makeAgent should not be invoked by /api/attention tests",
        );
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

  it("returns the same body and structured payload renderOnDemandAttention produces", async () => {
    const expected = renderOnDemandAttention({ projectDir, runsDir });

    const res = await fetch(`${baseUrl}/api/attention`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: typeof expected.items };
      text: string;
    };
    expect(body.text).toBe(expected.text);
    expect(body.data.items).toEqual(expected.items);
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it("does not write the cadence counter or emit workflow.attention.digest", async () => {
    const counterPath = join(runsDir, "..", "attention-digest-counter.json");
    expect(existsSync(counterPath)).toBe(false);

    const res = await fetch(`${baseUrl}/api/attention`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    expect(existsSync(counterPath)).toBe(false);
    expect(observed).toEqual([]);
  });

  it("rejects requests without the bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/attention`);
    expect(res.status).toBe(401);
  });

  it("accepts the token via the query parameter as well", async () => {
    const res = await fetch(`${baseUrl}/api/attention?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
