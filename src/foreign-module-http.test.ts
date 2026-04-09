/**
 * Tests for the HTTP transport for KEMP.
 *
 * Spins up a minimal in-process HTTP server that speaks KEMP, then exercises
 * the HttpTransport against it. No external binary or network required.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { KempInbound, KempOutbound } from "./foreign-extension.js";
import { HttpTransport } from "./foreign-extension-http.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

type Handler = (msg: KempOutbound, req: IncomingMessage) => KempInbound | null;

function startKempServer(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req);
        const msg = JSON.parse(body) as KempOutbound;
        const reply = handler(msg, req);
        if (reply === null) {
          res.writeHead(200).end();
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(reply));
        }
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });

    server.on("error", reject);
  });
}

describe("HttpTransport", () => {
  let closeServer: (() => Promise<void>) | null = null;
  let transport: HttpTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    if (closeServer) {
      await closeServer().catch(() => {});
      closeServer = null;
    }
  });

  it("happy path: init→manifest, invoke→result, shutdown→ack", async () => {
    const { url, close } = await startKempServer((msg) => {
      if (msg.type === "init") {
        return {
          id: msg.id, type: "manifest", name: "http-echo",
          tools: [{ name: "echo", description: "echo", input_schema: { type: "object", properties: {} } }],
        } satisfies KempInbound;
      }
      if (msg.type === "invoke") {
        return { id: msg.id, type: "result", content: JSON.stringify(msg.input) } satisfies KempInbound;
      }
      if (msg.type === "shutdown") {
        return { id: msg.id, type: "shutdown_ack" } satisfies KempInbound;
      }
      return null;
    });
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url });
    const gen = transport.receive();

    await transport.send({ id: "i1", type: "init", cwd: process.cwd() });
    const manifest = (await gen.next()).value as KempInbound;
    expect(manifest).toMatchObject({ type: "manifest", id: "i1", name: "http-echo" });

    await transport.send({ id: "inv1", type: "invoke", name: "echo", input: { x: 42 } });
    const result = (await gen.next()).value as KempInbound;
    expect(result).toMatchObject({ type: "result", id: "inv1" });
    expect(JSON.parse((result as { content: string }).content)).toEqual({ x: 42 });

    await transport.send({ id: "s1", type: "shutdown" });
    const ack = (await gen.next()).value;
    expect(ack).toMatchObject({ type: "shutdown_ack", id: "s1" });
  });

  it("unreachable server: send throws and transport closes", async () => {
    transport = new HttpTransport({ transport: "http", url: "http://127.0.0.1:1" });
    await expect(
      transport.send({ id: "i1", type: "init", cwd: process.cwd() }),
    ).rejects.toThrow();
  });

  it("empty response body is tolerated (no message queued)", async () => {
    const { url, close } = await startKempServer(() => null);
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url });
    await transport.send({ id: "s1", type: "shutdown" });
    // No message in queue — receive() should not yield
    await transport.close();
    const messages: unknown[] = [];
    for await (const msg of transport.receive()) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(0);
  });

  it("close() drains pending receive() waiters", async () => {
    const { url, close } = await startKempServer(() => null);
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url });
    const gen = transport.receive();
    const pendingNext = gen.next(); // waiting for a message
    await transport.close();
    const result = await pendingNext;
    expect(result.done).toBe(true);
  });

  it("send() after close() throws Transport closed", async () => {
    const { url, close } = await startKempServer(() => null);
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url });
    await transport.close();
    await expect(
      transport.send({ id: "x", type: "shutdown" }),
    ).rejects.toThrow("Transport closed");
  });

  it("bearerToken string: Authorization header is sent on every request", async () => {
    const receivedHeaders: string[] = [];
    const { url, close } = await startKempServer((_msg, req) => {
      receivedHeaders.push(req.headers.authorization ?? "");
      return null;
    });
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url, bearerToken: "secret-token" });
    await transport.send({ id: "s1", type: "shutdown" });
    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0]).toBe("Bearer secret-token");
  });

  it("bearerToken env ref: reads value from environment variable", async () => {
    const receivedHeaders: string[] = [];
    const { url, close } = await startKempServer((_msg, req) => {
      receivedHeaders.push(req.headers.authorization ?? "");
      return null;
    });
    closeServer = close;

    process.env.KEMP_TEST_TOKEN = "env-secret";
    try {
      transport = new HttpTransport({ transport: "http", url, bearerToken: { env: "KEMP_TEST_TOKEN" } });
      await transport.send({ id: "s1", type: "shutdown" });
      expect(receivedHeaders).toHaveLength(1);
      expect(receivedHeaders[0]).toBe("Bearer env-secret");
    } finally {
      delete process.env.KEMP_TEST_TOKEN;
    }
  });

  it("no bearerToken: Authorization header is absent", async () => {
    const receivedHeaders: string[] = [];
    const { url, close } = await startKempServer((_msg, req) => {
      receivedHeaders.push(req.headers.authorization ?? "absent");
      return null;
    });
    closeServer = close;

    transport = new HttpTransport({ transport: "http", url });
    await transport.send({ id: "s1", type: "shutdown" });
    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0]).toBe("absent");
  });
});
