import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { handleWorkflowSimulation } from "./routes.js";

function makeRequest(body: object): IncomingMessage {
  return Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
}

function makeResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number) => {
      result.status = status;
    }),
    end: vi.fn((body: string) => {
      result.body = JSON.parse(body);
    }),
  } as unknown as ServerResponse;
  return { res, result };
}

function workflowDefinition(): WorkflowDefinition {
  return {
    name: "route-simulation",
    enabled: true,
    moduleRoot: "/tmp/kota-route-test",
    recoveryCapable: false,
    tags: [],
    definitionPath: "/tmp/kota-route-test/workflow.ts",
    triggers: [
      {
        event: "route.event",
        cooldownMs: 0,
      },
    ],
    steps: [],
  };
}

describe("handleWorkflowSimulation", () => {
  it("returns a structured event simulation result", async () => {
    const { res, result } = makeResponse();

    await handleWorkflowSimulation(
      makeRequest({
        event: "route.event",
        payload: {
          scopeId: "scope-a",
          projectId: "scope-a",
        },
      }),
      res,
      {
        projectDir: "/tmp/kota-route-test",
        definitions: [workflowDefinition()],
        moduleManifests: [],
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        "would-queue": 1,
      },
      inputs: [
        {
          event: "route.event",
          outcome: "would-queue",
          matches: [
            {
              workflow: "route-simulation",
            },
          ],
        },
      ],
    });
  });
});
