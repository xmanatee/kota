import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { evalHarnessControlRoutes } from "./eval-control-routes.js";

type MockResponse = {
  res: ServerResponse;
  result: { status: number; body: unknown };
};

function mockResponse(): MockResponse {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: () => undefined,
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
  } as unknown as ServerResponse;
  return { res, result };
}

function makeFakeCtx(projectDir: string): ModuleContext {
  return { cwd: projectDir } as unknown as ModuleContext;
}

describe("evalHarnessControlRoutes GET /eval/list", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "eval-control-routes-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns fixture control decisions and aggregate coverage summary", () => {
    const routes = evalHarnessControlRoutes(makeFakeCtx(projectDir));
    const route = routes.find(
      (entry) => entry.method === "GET" && entry.path === "/eval/list",
    );
    if (!route) throw new Error("GET /eval/list route not registered");
    const { res, result } = mockResponse();

    route.handler({} as IncomingMessage, res, {});

    expect(result.status).toBe(200);
    const body = result.body as {
      fixtures: Array<{ id: string; controlDecisions: string[] }>;
      controlDecisionCoverage: { counts: Record<string, number> };
    };
    expect(body.fixtures.length).toBeGreaterThan(0);
    expect(body.fixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "builder-agent-call-replay",
        controlDecisions: expect.any(Array),
      }),
    ]));
    expect(body.controlDecisionCoverage.counts).toEqual(
      expect.objectContaining({ act: expect.any(Number), ask: expect.any(Number) }),
    );
  });
});
