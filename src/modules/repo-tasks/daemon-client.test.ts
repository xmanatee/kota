import { describe, expect, it } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import repoTasksModule from "./index.js";

function transport(
  respond: (path: string, init?: RequestInit) => Response | Promise<Response>,
): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("routine transport is generated and covered by integration");
    },
    fetchRaw: async (path, init) => respond(path, init as RequestInit | undefined),
    events: async function* () {},
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(respond: Parameters<typeof transport>[0]) {
  return repoTasksModule.daemonClient!(transport(respond)).tasks!;
}

describe("repo-tasks exceptional daemon transforms", () => {
  it("maps missing reads and move conflicts to the domain unions", async () => {
    await expect(client(() => json(404, {})).show("task-missing")).resolves.toEqual({
      found: false,
    });
    await expect(client(() => json(409, { state: "blocked" })).move(
      "task-a",
      "blocked",
    )).resolves.toEqual({
      ok: false,
      reason: "already_in_state",
      state: "blocked",
    });
  });

  it("preserves task and inbox validation failures without copied result arms", async () => {
    const invalid = client((path) => path.includes("capture")
      ? json(409, { error: "Inbox exists" })
      : json(400, { error: "Invalid title" }));
    await expect(invalid.create({ title: "?", priority: "p1" })).resolves.toEqual({
      ok: false,
      reason: "invalid_slug",
      message: "Invalid title",
    });
    await expect(invalid.capture("Existing")).resolves.toEqual({
      ok: false,
      reason: "already_exists",
      message: "Inbox exists",
    });
  });

  it("re-reads a body update so callers receive canonical persisted content", async () => {
    let calls = 0;
    const tasks = client(() => {
      calls += 1;
      return calls === 1
        ? json(200, {})
        : json(200, { state: "open", content: "# Canonical" });
    });
    await expect(tasks.updateBody!("task-a", "# Requested")).resolves.toEqual({
      ok: true,
      id: "task-a",
      state: "open",
      content: "# Canonical",
    });
  });
});
