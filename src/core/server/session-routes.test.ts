/**
 * Unit tests for session-route fallback resolution.
 *
 * The server treats `defaultAutonomyMode` as a lazy resolver so that an
 * unconfigured posture only blocks the request that actually needs a
 * fallback, not server boot. These tests pin that contract.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { SessionPool } from "./session-pool.js";
import { handleChat, handleCreateSession } from "./session-routes.js";

function makeRequest(body: Record<string, unknown>): IncomingMessage {
  return Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
}

function makeResponse(): {
  res: ServerResponse;
  status: () => number | undefined;
  body: () => Record<string, unknown>;
} {
  let writtenStatus: number | undefined;
  const chunks: string[] = [];
  const res = {
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    writeHead: (code: number, _headers?: Record<string, string>) => {
      writtenStatus = code;
      return res;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: vi.fn((chunk?: string) => {
      if (chunk) chunks.push(chunk);
    }),
    headersSent: false,
    on: vi.fn(),
  } as unknown as ServerResponse;
  return {
    res,
    status: () => writtenStatus,
    body: () => {
      const joined = chunks.join("");
      try {
        return JSON.parse(joined) as Record<string, unknown>;
      } catch {
        return { raw: joined };
      }
    },
  };
}

function mockAgent(): AgentSession {
  return {
    send: vi.fn(async () => "ok"),
    close: vi.fn(),
    getAutonomyMode: () => "passive" as AutonomyMode,
    setAutonomyMode: vi.fn(),
  } as unknown as AgentSession;
}

const makeAgent = (_t: Transport, _mode: AutonomyMode): AgentSession => mockAgent();

describe("handleCreateSession defers autonomy resolution", () => {
  it("does not invoke the resolver when the body specifies autonomy_mode", async () => {
    const pool = new SessionPool();
    const resolver = vi.fn(() => {
      throw new Error("autonomy mode is not configured");
    });
    const { res, status, body } = makeResponse();

    await handleCreateSession(
      makeRequest({ autonomy_mode: "supervised" }),
      res,
      pool,
      makeAgent,
      resolver as unknown as () => AutonomyMode,
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(status()).toBe(201);
    expect(body()).toMatchObject({ autonomy_mode: "supervised" });
  });

  it("invokes the resolver when the body omits autonomy_mode", async () => {
    const pool = new SessionPool();
    const resolver = vi.fn(() => "passive" as AutonomyMode);
    const { res, status, body } = makeResponse();

    await handleCreateSession(
      makeRequest({}),
      res,
      pool,
      makeAgent,
      resolver,
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(status()).toBe(201);
    expect(body()).toMatchObject({ autonomy_mode: "passive" });
  });

  it("returns a 400 with the resolver error when no autonomy posture is configured", async () => {
    const pool = new SessionPool();
    const resolver = () => {
      throw new Error("web server: autonomy mode is not configured. Set defaultAutonomyMode on the channel config or config.serve.defaultAutonomyMode on the daemon.");
    };
    const { res, status, body } = makeResponse();

    await handleCreateSession(
      makeRequest({}),
      res,
      pool,
      makeAgent,
      resolver,
    );

    expect(status()).toBe(400);
    expect(body()).toMatchObject({
      error: expect.stringContaining("autonomy mode is not configured"),
    });
  });
});

describe("handleChat defers autonomy resolution", () => {
  it("returns a 400 with the resolver error when no autonomy posture is configured", async () => {
    const pool = new SessionPool();
    const resolver = () => {
      throw new Error("web server: autonomy mode is not configured.");
    };
    const { res, status, body } = makeResponse();

    await handleChat(
      makeRequest({ message: "hi" }),
      res,
      pool,
      makeAgent,
      resolver,
    );

    expect(status()).toBe(400);
    expect(body()).toMatchObject({
      error: expect.stringContaining("autonomy mode is not configured"),
    });
  });
});
