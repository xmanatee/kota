import { mkdirSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { workflowStateRecoveryControlRoutes } from "./state-recovery-routes.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-state-recovery-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function jsonRequest(url: string, body: unknown): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  req.url = url;
  req.method = "POST";
  return req;
}

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data) as unknown;
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

describe("workflow state recovery control routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects traversal artifactRunId input before provider dispatch", async () => {
    const getProvider = vi.fn();
    const ctx = {
      cwd: projectDir,
      getProvider,
    } as unknown as ModuleContext;
    const route = workflowStateRecoveryControlRoutes(ctx).find(
      (candidate) => candidate.method === "POST",
    );
    if (!route) throw new Error("state recovery resolve route missing");

    const { res, result } = mockResponse();
    await route.handler(
      jsonRequest("/workflow/state-recovery/claims/task-a/resolve", {
        action: "release",
        rationale: "operator requested recovery",
        artifactRunId: "../escaped",
      }),
      res,
      { taskId: "task-a" },
    );

    expect(result).toMatchObject({
      status: 400,
      body: {
        error: expect.stringContaining("path-safe segment"),
      },
    });
    expect(getProvider).not.toHaveBeenCalled();
  });
});
