import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  KempManifest,
  KempResult,
  StdioForeignModuleConfig,
} from "./foreign-module.js";
import { StdioTransport } from "./foreign-module-stdio.js";

const PROJECT_CWD = process.cwd();
const ENV_PROBE_KEYS = [
  "KOTA_STDIO_NORMAL_ENV_TEST",
  "KOTA_SESSION_ID",
  "KOTA_TOOL_USE_ID",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_ENDPOINT",
] as const;
type EnvProbeKey = (typeof ENV_PROBE_KEYS)[number];
let savedEnv: Partial<Record<EnvProbeKey, string>>;

function nodeScript(script: string): StdioForeignModuleConfig {
  return { transport: "stdio", command: "node", args: ["-e", script] };
}

// Minimal KEMP module: responds to init, invoke, and shutdown
const ECHO_MODULE = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'init') {
    process.stdout.write(JSON.stringify({
      id: msg.id, type: 'manifest', name: 'echo',
      tools: [{ name: 'echo', description: 'echo', input_schema: { type: 'object', properties: {} } }]
    }) + '\\n');
  } else if (msg.type === 'invoke') {
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'result', content: JSON.stringify(msg.input) }) + '\\n');
  } else if (msg.type === 'shutdown') {
    process.stdout.write(JSON.stringify({ id: msg.id, type: 'shutdown_ack' }) + '\\n');
    process.exit(0);
  }
});
`;

const ENV_PROBE_MODULE = `
const keys = ${JSON.stringify(ENV_PROBE_KEYS)};
const values = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? 'missing']));
process.stdout.write(JSON.stringify({ id: 'env', type: 'result', content: JSON.stringify(values) }) + '\\n');
process.exit(0);
`;

describe("StdioTransport", () => {
  let transport: StdioTransport | null = null;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_PROBE_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(async () => {
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    for (const key of ENV_PROBE_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function readEnvProbe(
    config: StdioForeignModuleConfig,
  ): Promise<Record<EnvProbeKey, string>> {
    transport = new StdioTransport(config, PROJECT_CWD);
    const result = (await transport.receive().next()).value as KempResult;
    return JSON.parse(result.content) as Record<EnvProbeKey, string>;
  }

  it("happy path: init→manifest, invoke→result, shutdown→ack", async () => {
    transport = new StdioTransport(nodeScript(ECHO_MODULE), PROJECT_CWD);
    const gen = transport.receive();

    await transport.send({ id: "i1", type: "init", cwd: PROJECT_CWD });
    const manifest = (await gen.next()).value as KempManifest;
    expect(manifest).toMatchObject({ type: "manifest", id: "i1", name: "echo" });
    expect(manifest.tools).toHaveLength(1);

    await transport.send({ id: "inv1", type: "invoke", name: "echo", input: { x: 42 } });
    const result = (await gen.next()).value as KempResult;
    expect(result).toMatchObject({ type: "result", id: "inv1" });
    expect(JSON.parse(result.content)).toEqual({ x: 42 });

    await transport.send({ id: "s1", type: "shutdown" });
    const ack = (await gen.next()).value;
    expect(ack).toMatchObject({ type: "shutdown_ack", id: "s1" });

    // Subprocess exits after shutdown; generator completes
    const final = await gen.next();
    expect(final.done).toBe(true);
    transport = null;
  });

  it("spawn error: missing binary closes transport cleanly", async () => {
    transport = new StdioTransport(
      { transport: "stdio", command: "__no_such_binary_kota_test__", args: [] },
      PROJECT_CWD,
    );
    const messages: unknown[] = [];
    for await (const msg of transport.receive()) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(0);
  });

  it("unexpected subprocess exit → receive completes without error", async () => {
    transport = new StdioTransport(nodeScript("process.exit(0)"), PROJECT_CWD);
    const messages: unknown[] = [];
    for await (const msg of transport.receive()) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(0);
  });

  it("close() resolves without hanging", async () => {
    transport = new StdioTransport(nodeScript(ECHO_MODULE), PROJECT_CWD);
    const start = Date.now();
    await transport.close();
    expect(Date.now() - start).toBeLessThan(4000);
    transport = null;
  });

  it("preserves ordinary inherited env while scrubbing inherited telemetry and correlation env", async () => {
    process.env.KOTA_STDIO_NORMAL_ENV_TEST = "normal";
    process.env.KOTA_SESSION_ID = "parent-session";
    process.env.KOTA_TOOL_USE_ID = "parent-tool";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://kota-collector";
    process.env.OTLP_ENDPOINT = "http://legacy-collector";

    await expect(readEnvProbe(nodeScript(ENV_PROBE_MODULE))).resolves.toEqual({
      KOTA_STDIO_NORMAL_ENV_TEST: "normal",
      KOTA_SESSION_ID: "missing",
      KOTA_TOOL_USE_ID: "missing",
      OTEL_EXPORTER_OTLP_ENDPOINT: "missing",
      OTLP_ENDPOINT: "missing",
    });
  });

  it("applies config.env after inherited env filtering", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://parent-collector";
    process.env.OTLP_ENDPOINT = "http://parent-legacy-collector";

    await expect(
      readEnvProbe({
        ...nodeScript(ENV_PROBE_MODULE),
        env: {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://module-collector",
          OTLP_ENDPOINT: "http://module-legacy-collector",
        },
      }),
    ).resolves.toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://module-collector",
      OTLP_ENDPOINT: "http://module-legacy-collector",
    });
  });

  it("send() after close() throws Transport closed", async () => {
    transport = new StdioTransport(nodeScript(ECHO_MODULE), PROJECT_CWD);
    await transport.close();
    await expect(transport.send({ id: "x", type: "shutdown" })).rejects.toThrow(
      "Transport closed",
    );
    transport = null;
  });

  it("malformed JSON from subprocess is skipped; valid messages still received", async () => {
    const script = `
      process.stdout.write('not-valid-json\\n');
      process.stdout.write(JSON.stringify({ id: 'x', type: 'manifest', name: 'bad', tools: [] }) + '\\n');
      process.exit(0);
    `;
    transport = new StdioTransport(nodeScript(script), PROJECT_CWD);
    const messages: unknown[] = [];
    for await (const msg of transport.receive()) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "manifest", name: "bad" });
  });
});
