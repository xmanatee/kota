import { describe, expect, it } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import repoTasksModule from "./index.js";

function makeTransport(response: Response): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async () => response,
    events: async function* () {
      // empty generator
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("repo-tasks daemon client move security", () => {
  it("decodes typed invalid-id 400 responses", async () => {
    const transport = makeTransport(
      jsonResponse(400, { reason: "invalid_id", error: "Invalid task id" }),
    );

    expect(
      await repoTasksModule.daemonClient!(transport).tasks!.move("../AGENTS", "doing"),
    ).toEqual({ ok: false, reason: "invalid_id" });
  });
});
