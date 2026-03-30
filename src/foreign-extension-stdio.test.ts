import { afterEach, describe, expect, it } from "vitest";
import type {
  ForeignExtensionConfig,
  KempManifest,
  KempResult,
} from "./foreign-extension.js";
import { StdioTransport } from "./foreign-extension-stdio.js";

const PROJECT_CWD = process.cwd();

function nodeScript(script: string): ForeignExtensionConfig {
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

describe("StdioTransport", () => {
  let transport: StdioTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
  });

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
