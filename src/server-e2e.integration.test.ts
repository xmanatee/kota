/**
 * End-to-end integration tests for the HTTP server.
 *
 * Exercises the full path: HTTP request → router → session pool → agent session
 * → transport (SSE or Vercel Data Stream via module route) → HTTP response.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import http from "node:http";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

let mockSendFn: ((message: string, transport: any) => Promise<string>) | undefined;

vi.mock("./core/loop/loop.js", () => {
  class MockAgentSession {
    private transport: any;
    private autonomyMode: "passive" | "supervised" | "autonomous";
    send: (message: string) => Promise<string>;
    close = vi.fn();
    getCostSummary = () => "$0.001";
    getConversationId = () => null;
    getAutonomyMode = () => this.autonomyMode;
    setAutonomyMode = (mode: "passive" | "supervised" | "autonomous") => {
      this.autonomyMode = mode;
    };

    constructor(opts: any) {
      this.transport = opts?.transport;
      this.autonomyMode = opts?.autonomyMode ?? "autonomous";
      this.send = async (message: string) => {
        if (mockSendFn) return mockSendFn(message, this.transport);
        this.transport?.emit({ type: "status", message: "[kota] Turn 1" });
        this.transport?.emit({ type: "text", content: `Echo: ${message}` });
        this.transport?.emit({ type: "cost", summary: "$0.001", budgetPercent: 5 });
        return `Echo: ${message}`;
      };
    }
  }
  return { AgentSession: MockAgentSession };
});

import { EventBus } from "./core/events/event-bus.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import { discoverProjectModules } from "./core/modules/project-discovery.js";
import { startServer } from "./core/server/server.js";
import {
  registerServerE2EBasicCases,
  type ServerE2ETestContext,
} from "./server-e2e-basic-cases.integration.js";
import { registerServerE2ERuntimeCases } from "./server-e2e-runtime-cases.integration.js";

let server: Server;
let loader: ModuleLoader;
let baseUrl: string;
const TEST_AUTH_TOKEN = "test-e2e-auth-token-abc123";
const projectModules = await discoverProjectModules();
const webDistDir = join(process.cwd(), "clients", "web", "dist");
const webAssetName = "kota-e2e-dashboard.js";
let seededWebDist = false;
const createdSessionIds: string[] = [];

function waitForPort(value: Server): Promise<number> {
  return new Promise((resolve) => {
    if (value.listening) {
      resolve((value.address() as { port: number }).port);
    } else {
      value.on("listening", () => resolve((value.address() as { port: number }).port));
    }
  });
}

function seedWebDistForE2E(): void {
  if (existsSync(join(webDistDir, "index.html"))) return;
  mkdirSync(join(webDistDir, "assets"), { recursive: true });
  writeFileSync(
    join(webDistDir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head><script type=\"module\" src=\"/assets/kota-e2e-dashboard.js\"></script></head>",
      "<body><div id=\"root\">KOTA</div></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(webDistDir, "assets", webAssetName),
    "window.__KOTA_E2E_DASHBOARD__ = true;\n",
    "utf-8",
  );
  seededWebDist = true;
}

function cleanupSeededWebDist(): void {
  if (!seededWebDist) return;
  rmSync(join(webDistDir, "index.html"), { force: true });
  rmSync(join(webDistDir, "assets", webAssetName), { force: true });
  try {
    if (readdirSync(join(webDistDir, "assets")).length === 0) {
      rmSync(join(webDistDir, "assets"), { recursive: true, force: true });
    }
    if (readdirSync(webDistDir).length === 0) {
      rmSync(webDistDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup for test-only files.
  }
}

function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of raw.split("\n\n").filter(Boolean)) {
    let eventName = "";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice(7);
      if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (eventName && dataStr) {
      try {
        events.push({ event: eventName, data: JSON.parse(dataStr) });
      } catch {
        events.push({ event: eventName, data: dataStr });
      }
    }
  }
  return events;
}

function httpReq(opts: {
  method: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  noAuth?: boolean;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(opts.path, baseUrl);
  const headers: Record<string, string> = opts.noAuth
    ? {}
    : { Authorization: `Bearer ${TEST_AUTH_TOKEN}` };
  if (opts.body !== undefined || opts.rawBody) headers["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: opts.method, headers }, (response) => {
      const chunks: string[] = [];
      response.setEncoding("utf-8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode!,
        headers: response.headers,
        body: chunks.join(""),
      }));
    });
    request.on("error", reject);
    if (opts.rawBody) request.write(opts.rawBody);
    else if (opts.body !== undefined) request.write(JSON.stringify(opts.body));
    request.end();
  });
}

async function createSession(): Promise<string> {
  const response = await httpReq({ method: "POST", path: "/api/sessions" });
  const sessionId = JSON.parse(response.body).session_id;
  createdSessionIds.push(sessionId);
  return sessionId;
}

const testContext: ServerE2ETestContext & {
  setMockSend(send: typeof mockSendFn): void;
} = {
  get authToken() { return TEST_AUTH_TOKEN; },
  get baseUrl() { return baseUrl; },
  createdSessionIds,
  createSession,
  httpReq,
  parseSSE,
  setMockSend(send) { mockSendFn = send; },
};

beforeAll(async () => {
  seedWebDistForE2E();
  const originalLog = console.log;
  console.log = () => {};
  const testConfig = { serve: { defaultAutonomyMode: "autonomous" } } as any;
  const eventBus = new EventBus();
  loader = new ModuleLoader(testConfig, false, { mode: "runtime" });
  loader.setBus(eventBus);
  await loader.loadAll(projectModules);
  server = startServer({
    port: 0,
    config: testConfig,
    eventBus,
    moduleLoader: loader,
    moduleRoutes: loader.getRoutes(),
    authToken: TEST_AUTH_TOKEN,
    resolveDefaultAutonomyMode: () => testConfig.serve.defaultAutonomyMode,
    assembleDaemonHandlers: (transport) => loader.assembleDaemonClientHandlers(transport),
  });
  const port = await waitForPort(server);
  console.log = originalLog;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  await loader.unloadAll();
  cleanupSeededWebDist();
});

afterEach(async () => {
  mockSendFn = undefined;
  for (const sessionId of createdSessionIds) {
    await httpReq({ method: "DELETE", path: `/api/sessions/${sessionId}` }).catch(() => {});
  }
  createdSessionIds.length = 0;
});

registerServerE2EBasicCases(testContext);
registerServerE2ERuntimeCases(testContext);
