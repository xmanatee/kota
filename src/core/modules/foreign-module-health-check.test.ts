/**
 * Tests for KEMP health_check / health_status message pair:
 * - module reports healthy
 * - module reports degraded with detail message
 * - module does not respond (timeout → assume healthy)
 */

import { expect, it, onTestFinished } from "vitest";
import type { StdioForeignModuleConfig } from "./foreign-module.js";
import { loadForeignModules } from "./foreign-module-loader.js";

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

it.each([
  ["healthy", "healthy", undefined],
  ["degraded", "degraded", "DB pool exhausted"],
  ["unhealthy", "unhealthy", "API key expired"],
  ["no-response", "healthy", undefined],
] as const)(
  "projects subprocess health %s as %s",
  async (behavior, status, message) => {
    const [candidate] = await loadForeignModules([healthModule(behavior)], process.cwd());
    onTestFinished(() => candidate.discard());
    const result = await candidate.definition.healthCheck!();
    expect(result.status).toBe(status);
    expect(result.message).toBe(message);
  },
  10_000,
);
