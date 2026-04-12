/**
 * Tests for KEMP health_check / health_status message pair:
 * - module reports healthy
 * - module reports degraded with detail message
 * - module does not respond (timeout → assume healthy)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StdioForeignModuleConfig } from "./core/modules/foreign-module.js";
import { loadForeignModules } from "./core/modules/foreign-module-loader.js";

const PROJECT_CWD = process.cwd();

const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("./core/events/event-bus.js", () => ({ tryEmit: tryEmitMock }));

beforeEach(() => { tryEmitMock.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

function healthModule(
  behavior: "healthy" | "degraded" | "unhealthy" | "no-response",
): StdioForeignModuleConfig {
  const script = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'init') {
    process.stdout.write(JSON.stringify({
      id: msg.id, type: 'manifest', name: 'health-test',
      tools: [{ name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {} } }]
    }) + '\\n');
  } else if (msg.type === 'ping') {
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'pong' }) + '\\n');
  } else if (msg.type === 'health_check') {
    const behavior = ${JSON.stringify(behavior)};
    if (behavior === 'healthy') {
      process.stdout.write(JSON.stringify({ id: msg.id, type: 'health_status', status: 'healthy' }) + '\\n');
    } else if (behavior === 'degraded') {
      process.stdout.write(JSON.stringify({ id: msg.id, type: 'health_status', status: 'degraded', message: 'DB pool exhausted' }) + '\\n');
    } else if (behavior === 'unhealthy') {
      process.stdout.write(JSON.stringify({ id: msg.id, type: 'health_status', status: 'unhealthy', message: 'API key expired' }) + '\\n');
    }
    // 'no-response': intentionally do not respond
  } else if (msg.type === 'shutdown') {
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'shutdown_ack' }) + '\\n');
    process.exit(0);
  }
});
`;
  return {
    transport: "stdio",
    command: "node",
    args: ["-e", script],
    maxRestarts: 0,
  };
}

describe("KEMP health_check / health_status", () => {
  it("module reports healthy", async () => {
    const [ext] = await loadForeignModules([healthModule("healthy")], PROJECT_CWD);
    expect(ext).toBeDefined();
    expect(ext.healthCheck).toBeDefined();

    const result = await ext.healthCheck!();
    expect(result.status).toBe("healthy");
    expect(result.message).toBeUndefined();

    await ext.onUnload?.();
  }, 10_000);

  it("module reports degraded with detail message", async () => {
    const [ext] = await loadForeignModules([healthModule("degraded")], PROJECT_CWD);
    expect(ext).toBeDefined();

    const result = await ext.healthCheck!();
    expect(result.status).toBe("degraded");
    expect(result.message).toBe("DB pool exhausted");

    await ext.onUnload?.();
  }, 10_000);

  it("module reports unhealthy with detail message", async () => {
    const [ext] = await loadForeignModules([healthModule("unhealthy")], PROJECT_CWD);
    expect(ext).toBeDefined();

    const result = await ext.healthCheck!();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("API key expired");

    await ext.onUnload?.();
  }, 10_000);

  it("module does not respond to health_check → assume healthy", async () => {
    const [ext] = await loadForeignModules([healthModule("no-response")], PROJECT_CWD);
    expect(ext).toBeDefined();

    const result = await ext.healthCheck!();
    expect(result.status).toBe("healthy");

    await ext.onUnload?.();
  }, 10_000);
});
