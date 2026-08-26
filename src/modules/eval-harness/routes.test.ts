/**
 * `POST /api/eval/run` route shape pin.
 *
 * After the evalHarness namespace migrated through `daemonClient(link)`,
 * the daemon route was reshaped from the prior `400 + { error }` typed-
 * failure shape to a uniform `200 + EvalRunResult` discriminated body
 * (matching the skills migration precedent). The malformed-JSON and
 * type-mismatch protocol errors stay on `400 + { error }` because they
 * are genuine client protocol errors, not typed eval failures.
 *
 * The migration's daemon-side handler decodes the body via
 * `requestStrict<T>` and depends on this protocol shape.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { evalHarnessRoutes } from "./routes.js";

type MockResponse = {
  res: ServerResponse;
  result: { status: number; body: unknown };
};

function mockResponse(): MockResponse {
  const result = { status: 0, body: null as unknown };
  const res = {
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(body: string): IncomingMessage {
  let yielded = false;
  const iterator: AsyncIterator<Buffer> = {
    next: async () => {
      if (yielded) return { done: true, value: undefined as unknown as Buffer };
      yielded = true;
      return { done: false, value: Buffer.from(body, "utf-8") };
    },
  };
  return {
    [Symbol.asyncIterator]: () => iterator,
  } as unknown as IncomingMessage;
}

function makeFakeCtx(workspaceRoot: string): ModuleContext {
  const events = {
    emit: () => {},
    subscribe: () => () => {},
    emitExternal: () => {},
    subscribeExternal: () => () => {},
    listenerCount: () => 0,
  } as unknown as ModuleContext["events"];
  return { cwd: workspaceRoot, events } as unknown as ModuleContext;
}

describe("evalHarnessRoutes POST /api/eval/run", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "eval-routes-"));
    mkdirSync(join(workspaceRoot, "src/modules/eval-harness/fixtures"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function findRunHandler(): (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void> {
    const ctx = makeFakeCtx(workspaceRoot);
    const routes = evalHarnessRoutes(ctx);
    const route = routes.find(
      (r) => r.method === "POST" && r.path === "/api/eval/run",
    );
    if (!route) throw new Error("POST /api/eval/run route not registered");
    return route.handler as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<void>;
  }

  it("emits 200 + { ok: false, reason: 'no_fixtures', message } when the fixtures dir is empty", async () => {
    const handler = findRunHandler();
    const { res, result } = mockResponse();
    await handler(mockRequest("{}"), res);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: false,
      reason: "no_fixtures",
    });
    const body = result.body as { message: string };
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("emits 200 + { ok: false, reason: 'fixture_provenance', message } when the requested fixture does not exist", async () => {
    const handler = findRunHandler();
    const { res, result } = mockResponse();
    await handler(
      mockRequest(JSON.stringify({ fixtureIds: ["does-not-exist"] })),
      res,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: false,
      reason: "fixture_provenance",
    });
  });

  it("emits 400 + { error } when the request body is malformed JSON (preserved protocol error)", async () => {
    const handler = findRunHandler();
    const { res, result } = mockResponse();
    await handler(mockRequest("{not-json"), res);
    expect(result.status).toBe(400);
    const body = result.body as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("emits 400 + { error } when an option is the wrong type (preserved protocol error)", async () => {
    const handler = findRunHandler();
    const { res, result } = mockResponse();
    await handler(
      mockRequest(JSON.stringify({ fixtureIds: "not-an-array" })),
      res,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: expect.any(String) });
  });

  it("emits 400 + { error } when container isolation fields are incomplete", async () => {
    const handler = findRunHandler();
    const { res, result } = mockResponse();
    await handler(
      mockRequest(
        JSON.stringify({
          isolationBackend: { kind: "container", executable: "docker" },
        }),
      ),
      res,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: expect.stringContaining("isolationBackend.image"),
    });
  });

  it("registers the AGY suite route and rejects an empty candidate list", async () => {
    const route = evalHarnessRoutes(makeFakeCtx(workspaceRoot)).find(
      (candidate) =>
        candidate.method === "POST" &&
        candidate.path === "/api/eval/agy-models",
    );
    if (!route) {
      throw new Error("POST /api/eval/agy-models route not registered");
    }
    const { res, result } = mockResponse();

    await route.handler(
      mockRequest(JSON.stringify({ candidates: [], effort: "max" })),
      res,
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: expect.stringContaining("candidates"),
    });
  });

  it("rejects AGY host execution before dispatching the suite", async () => {
    const route = evalHarnessRoutes(makeFakeCtx(workspaceRoot)).find(
      (candidate) =>
        candidate.method === "POST" &&
        candidate.path === "/api/eval/agy-models",
    );
    if (!route) {
      throw new Error("POST /api/eval/agy-models route not registered");
    }
    const { res, result } = mockResponse();

    await route.handler(
      mockRequest(
        JSON.stringify({
          candidates: ["gemini-3.6-flash"],
          effort: "max",
          isolationBackend: { kind: "host-subprocess" },
        }),
      ),
      res,
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: expect.stringContaining("requires container isolation"),
    });
  });

  it("rejects AGY containers without Google provider egress", async () => {
    const route = evalHarnessRoutes(makeFakeCtx(workspaceRoot)).find(
      (candidate) =>
        candidate.method === "POST" &&
        candidate.path === "/api/eval/agy-models",
    );
    if (!route) {
      throw new Error("POST /api/eval/agy-models route not registered");
    }
    const baseBackend = {
      kind: "container",
      executable: "docker",
      image: "kota-eval:latest",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    };
    const cases = [
      {
        networkPolicy: { kind: "offline" },
        message: "requires a provider-egress container network",
      },
      {
        networkPolicy: {
          kind: "provider-egress",
          provider: "openai",
          enforcement: {
            kind: "docker-internal-proxy",
            networkName: "kota-provider-egress",
            proxyUrl: "http://provider-proxy:8080",
          },
        },
        message: "requires Google provider egress",
      },
    ];

    for (const testCase of cases) {
      const { res, result } = mockResponse();
      await route.handler(
        mockRequest(
          JSON.stringify({
            candidates: ["gemini-3.6-flash"],
            effort: "max",
            isolationBackend: {
              ...baseBackend,
              networkPolicy: testCase.networkPolicy,
            },
          }),
        ),
        res,
      );
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({
        error: expect.stringContaining(testCase.message),
      });
    }
  });
});
