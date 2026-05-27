import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function seedFixture(projectDir: string, id: string, controlDecisions: string[]): void {
  const dir = join(projectDir, "src/modules/eval-harness/fixtures", id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify(
      {
        id,
        description: id,
        role: "builder",
        workflowName: "builder",
        budgetMs: 60_000,
        predicates: [{ kind: "file-exists", path: "marker.txt" }],
        preRunExpectations: [
          {
            predicate: { kind: "file-exists", path: "marker.txt" },
            expected: "fail",
          },
        ],
        controlDecisions,
        provenance: {
          kind: "smoke-fixture",
          justification: "control route fixture",
        },
      },
      null,
      2,
    ),
  );
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
    seedFixture(projectDir, "act-fixture", ["act"]);
    const routes = evalHarnessControlRoutes(makeFakeCtx(projectDir));
    const route = routes.find(
      (entry) => entry.method === "GET" && entry.path === "/eval/list",
    );
    if (!route) throw new Error("GET /eval/list route not registered");
    const { res, result } = mockResponse();

    route.handler({} as IncomingMessage, res, {});

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      fixtures: [
        {
          id: "act-fixture",
          controlDecisions: ["act"],
        },
      ],
      controlDecisionCoverage: {
        counts: { act: 1, ask: 0 },
        missingDecisions: expect.arrayContaining(["ask"]),
      },
    });
  });
});
