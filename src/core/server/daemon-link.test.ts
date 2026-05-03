import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { buildMigratedNamespaceTestStubs } from "./daemon-client-test-stubs.js";
import { DaemonLink } from "./daemon-link.js";

type MockDaemon = {
  server: Server;
  port: number;
  startedAt: string;
  token: string;
  registrations: Array<{ id: string; createdAt: string; autonomyMode: string; authHeader?: string }>;
  stop(): Promise<void>;
};

async function startMockDaemon(): Promise<MockDaemon> {
  const registrations: MockDaemon["registrations"] = [];
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const startedAt = new Date(Date.now() + Math.random() * 1000).toISOString();

  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/sessions/register") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
          id: string;
          createdAt: string;
          autonomyMode: string;
        };
        registrations.push({
          id: body.id,
          createdAt: body.createdAt,
          autonomyMode: body.autonomyMode,
          authHeader: req.headers.authorization,
        });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400).end();
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });

  return {
    server,
    port,
    startedAt,
    token,
    registrations,
    stop() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

describe("DaemonLink", () => {
  let tempDir: string;
  let stateDir: string;
  let controlFile: string;
  let link: DaemonLink | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kota-daemon-link-"));
    stateDir = join(tempDir, ".kota");
    mkdirSync(stateDir, { recursive: true });
    controlFile = join(stateDir, "daemon-control.json");
    link = null;
  });

  afterEach(() => {
    link?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeControlFile(daemon: Pick<MockDaemon, "port" | "startedAt" | "token">): void {
    writeJsonFileAtomic(controlFile, {
      port: daemon.port,
      pid: process.pid,
      startedAt: daemon.startedAt,
      token: daemon.token,
    });
  }

  it("binds to a daemon already running at serve startup without reconnect-side effects", async () => {
    const daemon = await startMockDaemon();
    writeControlFile(daemon);

    const reconnects: string[] = [];
    link = new DaemonLink({
      stateDir,
      onReconnect: () => { reconnects.push("reconnect"); },
      assembleDaemonHandlers: () => buildMigratedNamespaceTestStubs(),
    });

    expect(link.current()).not.toBeNull();
    // Initial binding fires onReconnect once with no sessions to sync.
    expect(reconnects).toHaveLength(1);

    await daemon.stop();
  });

  it("rebuilds the client and re-runs onReconnect when the daemon restarts", async () => {
    const daemonA = await startMockDaemon();
    writeControlFile(daemonA);

    // A serve-like caller that re-registers a known session on every reconnect.
    const session = { id: "sess-1", createdAt: "2026-04-20T00:00:00.000Z", autonomyMode: "autonomous" as const };
    link = new DaemonLink({
      stateDir,
      onReconnect: async (client) => {
        await client.registerSession(session.id, session.createdAt, session.autonomyMode);
      },
      assembleDaemonHandlers: () => buildMigratedNamespaceTestStubs(),
    });

    await link.refresh();
    expect(daemonA.registrations).toHaveLength(1);
    expect(daemonA.registrations[0]).toMatchObject({
      id: "sess-1",
      createdAt: "2026-04-20T00:00:00.000Z",
      autonomyMode: "autonomous",
      authHeader: `Bearer ${daemonA.token}`,
    });

    // Simulate daemon restart: stop A, then a fresh daemon B picks up the
    // same project and writes a new control file (different port, startedAt,
    // and token).
    await daemonA.stop();
    rmSync(controlFile);

    const daemonB = await startMockDaemon();
    writeControlFile(daemonB);
    expect(daemonB.port).not.toBe(daemonA.port);
    expect(daemonB.token).not.toBe(daemonA.token);

    await link.refresh();

    expect(daemonB.registrations).toHaveLength(1);
    expect(daemonB.registrations[0]).toMatchObject({
      id: "sess-1",
      createdAt: "2026-04-20T00:00:00.000Z",
      autonomyMode: "autonomous",
      authHeader: `Bearer ${daemonB.token}`,
    });
    expect(daemonA.registrations).toHaveLength(1);

    await daemonB.stop();
  });

  it("reports no client while the control file is absent and recovers when it reappears", async () => {
    link = new DaemonLink({
      stateDir,
      onReconnect: () => { /* no-op */ },
      assembleDaemonHandlers: () => buildMigratedNamespaceTestStubs(),
    });
    await link.refresh();
    expect(link.current()).toBeNull();

    const daemon = await startMockDaemon();
    writeControlFile(daemon);
    await link.refresh();

    expect(link.current()).not.toBeNull();
    await daemon.stop();
  });

  it("does not fire onReconnect when reconciling the same daemon identity", async () => {
    const daemon = await startMockDaemon();
    writeControlFile(daemon);

    let reconnects = 0;
    link = new DaemonLink({
      stateDir,
      onReconnect: () => { reconnects += 1; },
      assembleDaemonHandlers: () => buildMigratedNamespaceTestStubs(),
    });
    await link.refresh();
    expect(reconnects).toBe(1);

    await link.refresh();
    await link.refresh();
    expect(reconnects).toBe(1);

    await daemon.stop();
  });
});
