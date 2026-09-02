import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { taskControlRoutes } from "./routes-control.js";
import { mockResponse } from "./routes-test-helpers.js";

describe("repo-task control route query validation", () => {
  it("rejects an invalid task state instead of falling back to the default list", async () => {
    const route = taskControlRoutes().find(
      ({ method, path }) => method === "GET" && path === "/tasks",
    );
    const { res, result } = mockResponse();
    const req = {
      url: "/tasks?state=open&state=future",
    } as IncomingMessage;

    await route?.handler(req, res, {});

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Invalid task state: future",
      reason: "invalid_state",
      state: "future",
    });
  });
});
