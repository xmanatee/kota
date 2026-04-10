/**
 * Tests for KEMP foreign module subprocess recovery:
 * - crash restart with successful recovery
 * - max restarts exhausted → module.failed emitted
 * - ping timeout → restart triggered → module.failed after exhaustion
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StdioForeignModuleConfig } from "./core/modules/foreign-module.js";
import { loadForeignModules } from "./core/modules/foreign-module-loader.js";

const PROJECT_CWD = process.cwd();

// Mock the event bus so we can observe module.failed emissions
const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("./core/events/event-bus.js", () => ({ tryEmit: tryEmitMock }));

beforeEach(() => { tryEmitMock.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

type ResilienceConfig = Omit<StdioForeignModuleConfig, "transport" | "command" | "args">;

/**
 * Module that uses a counter file to vary behavior by spawn count.
 * - spawn count <= crashOnSpawns: init/manifest OK then crash (triggers watchDeath)
 * - spawn count > crashOnSpawns: init/manifest OK and handles invocations normally
 * - spawn count > crashOnSpawns AND noManifestAfter: exit before manifest (so createRawModule fails)
 */
function countingModule(
  countFile: string,
  opts: {
    /** Spawns up to this count crash after manifest (to trigger watchDeath). */
    crashAfterManifest?: number;
    /** Spawns above this count exit before manifest (createRawModule fails). */
    failRestarts?: boolean;
    /** Crash on invoke rather than immediately after manifest. */
    crashOnInvoke?: boolean;
    /** Never respond to ping messages. */
    noPing?: boolean;
    moduleName?: string;
  } = {},
): StdioForeignModuleConfig {
  const {
    crashAfterManifest = 0,
    failRestarts = false,
    crashOnInvoke = false,
    noPing = false,
    moduleName = "test-module",
  } = opts;
  const script = `
const fs = require('fs');
const countFile = ${JSON.stringify(countFile)};
let count = 0;
if (fs.existsSync(countFile)) {
  count = parseInt(fs.readFileSync(countFile, 'utf8'));
}
count++;
fs.writeFileSync(countFile, String(count));

const failRestarts = ${failRestarts};
const crashAfterManifest = ${crashAfterManifest};
const crashOnInvoke = ${crashOnInvoke};
const noPing = ${noPing};

// Restart spawns: crash before manifest so createRawModule fails fast
if (failRestarts && count > 1) {
  process.exit(1);
}

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'init') {
    process.stdout.write(JSON.stringify({
      id: msg.id, type: 'manifest', name: ${JSON.stringify(moduleName)},
      tools: [{ name: 'echo', description: 'echo', input_schema: { type: 'object', properties: { v: { type: 'string' } } } }]
    }) + '\\n');
    if (!crashOnInvoke && count <= crashAfterManifest) {
      // crash after manifest, before any invocation
      process.exit(1);
    }
  } else if (msg.type === 'invoke') {
    if (crashOnInvoke && count <= crashAfterManifest) {
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'result', content: msg.input.v || 'ok' }) + '\\n');
  } else if (msg.type === 'ping') {
    if (!noPing) {
      process.stdout.write(JSON.stringify({ id: msg.id, type: 'pong' }) + '\\n');
    }
    // if noPing: intentionally do not respond — simulates hung process
  } else if (msg.type === 'shutdown') {
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'shutdown_ack' }) + '\\n');
    process.exit(0);
  }
});
`;
  return { transport: "stdio", command: "node", args: ["-e", script] };
}

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-test-"));
  const f = join(dir, "count.txt");
  writeFileSync(f, "0");
  return f;
}

function fastConfig(extra: ResilienceConfig = {}): ResilienceConfig {
  return { restartBackoffBaseMs: 50, ...extra };
}

describe("KEMP resilient module — crash restart", () => {
  it("subprocess crash triggers restart; tool works after recovery", async () => {
    const countFile = tempFile();
    // spawn 1 crashes on invoke; spawn 2+ works normally
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { crashAfterManifest: 1, crashOnInvoke: true, moduleName: "resilient" }),
      ...fastConfig({ maxRestarts: 2 }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();

    const tool = (ext.tools as { tool: { name: string }; runner: (i: Record<string, unknown>) => Promise<{ content: string; is_error?: boolean }> }[])
      .find((t) => t.tool.name === "echo")!;

    // First invoke: spawn 1 crashes on invoke → error result
    const firstResult = await tool.runner({ v: "hello" });
    expect(firstResult.is_error).toBe(true);

    // Wait for restart (50ms backoff + spawn time); use a generous budget for slow CI environments
    await new Promise((r) => setTimeout(r, 3000));

    // Second invoke: spawn 2 handles correctly
    const secondResult = await tool.runner({ v: "world" });
    expect(secondResult.is_error).toBeFalsy();
    expect(secondResult.content).toBe("world");

    await ext.onUnload?.();
  }, 10_000);
});

describe("KEMP resilient module — max restarts exhausted", () => {
  it("emits module.failed after all restart attempts fail", async () => {
    const countFile = tempFile();
    // spawn 1: init/manifest OK, then crashes → watchDeath fires
    // spawn 2+: exit before manifest → createRawModule fails
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { crashAfterManifest: 1, failRestarts: true, moduleName: "exhaust-ext" }),
      ...fastConfig({ maxRestarts: 2 }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();

    // Give time for initial crash → doRestart → all attempts fail
    // backoffs: 50ms + 100ms = 150ms + processing time
    await new Promise((r) => setTimeout(r, 1500));

    expect(tryEmitMock).toHaveBeenCalledWith("module.failed", expect.objectContaining({
      name: "exhaust-ext",
      reason: expect.any(String),
    }));

    await ext.onUnload?.();
  }, 10_000);
});

describe("KEMP resilient module — health state tracking", () => {
  it("starts with ok status and zero restarts", async () => {
    const countFile = tempFile();
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { moduleName: "health-ext" }),
      ...fastConfig({ maxRestarts: 2 }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();
    expect(ext.getHealth).toBeDefined();

    const health = ext.getHealth!();
    expect(health.status).toBe("ok");
    expect(health.restartCount).toBe(0);
    expect(health.lastRestartAt).toBeUndefined();

    await ext.onUnload?.();
  }, 10_000);

  it("increments restartCount and sets lastRestartAt after a crash-restart cycle", async () => {
    const countFile = tempFile();
    // spawn 1 crashes after manifest; spawn 2+ works normally
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { crashAfterManifest: 1, crashOnInvoke: true, moduleName: "health-restart-ext" }),
      ...fastConfig({ maxRestarts: 2 }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();

    // Trigger the crash via first invoke
    const tool = (ext.tools as { tool: { name: string }; runner: (i: Record<string, unknown>) => Promise<unknown> }[])
      .find((t) => t.tool.name === "echo")!;
    await tool.runner({ v: "trigger" });

    // Wait for restart to complete; use a generous budget for slow CI environments
    await new Promise((r) => setTimeout(r, 3000));

    const health = ext.getHealth!();
    expect(health.restartCount).toBeGreaterThan(0);
    expect(health.lastRestartAt).toBeDefined();
    expect(typeof health.lastRestartAt).toBe("string");
    expect(health.status).toBe("ok");

    await ext.onUnload?.();
  }, 10_000);

  it("sets status to dead when all restarts exhausted", async () => {
    const countFile = tempFile();
    // spawn 1 crashes; all restart attempts also fail
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { crashAfterManifest: 1, failRestarts: true, moduleName: "health-dead-ext" }),
      ...fastConfig({ maxRestarts: 2 }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();

    // Wait for all restarts to exhaust (backoffs: 50ms + 100ms = 150ms + processing)
    await new Promise((r) => setTimeout(r, 1500));

    const health = ext.getHealth!();
    expect(health.status).toBe("dead");
    expect(health.restartCount).toBeGreaterThan(0);

    await ext.onUnload?.();
  }, 10_000);
});

describe("KEMP resilient module — ping timeout", () => {
  it("hung subprocess detected via ping timeout triggers restart and module.failed after exhaustion", async () => {
    const countFile = tempFile();
    // spawn 1: init/manifest OK but never responds to ping
    // spawn 2+: exit before manifest → createRawModule fails → restarts exhausted
    const config: StdioForeignModuleConfig = {
      ...countingModule(countFile, { noPing: true, failRestarts: true, moduleName: "no-ping-ext" }),
      ...fastConfig({
        maxRestarts: 1,
        pingTimeoutMs: 150,
        pingIntervalMs: 200,
      }),
    };

    const [ext] = await loadForeignModules([config], PROJECT_CWD);
    expect(ext).toBeDefined();

    // Wait: pingIntervalMs(200) + pingTimeoutMs(150) + backoff(50) + processing
    await new Promise((r) => setTimeout(r, 2000));

    expect(tryEmitMock).toHaveBeenCalledWith("module.failed", expect.objectContaining({
      name: "no-ping-ext",
      reason: expect.stringContaining("ping"),
    }));

    await ext.onUnload?.();
  }, 15_000);
});
