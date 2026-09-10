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
      : json(400, { reason: "invalid_slug", error: "Invalid title" }));
    await expect(invalid.create({ title: "?", body: "Keep the complete request.", priority: "p1" })).resolves.toEqual({
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

  it("submits the full task body and preserves body rejection", async () => {
    const body = "First detail\n\n  Indented evidence\nLast detail.  \n";
    const tasks = client((path, init) => {
      expect(path).toBe("/api/tasks/normalized?scopeId=remote");
      expect(JSON.parse(String(init?.body))).toEqual({ title: "Remote task", body, priority: "p1" });
      return json(400, { reason: "invalid_body", error: "Complete body required" });
    });
    await expect(tasks.create({ title: "Remote task", body, priority: "p1", scopeId: "remote" }))
      .resolves.toEqual({ ok: false, reason: "invalid_body", message: "Complete body required" });
    await expect(client(() => json(400, { error: "Task body must contain authored intent beyond its title" }))
      .updateBody("task-a", "# Requested\n\n<!-- unfinished -->"))
      .resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("re-reads a body update so callers receive canonical persisted content", async () => {
    let calls = 0;
    const tasks = client(() => {
      calls += 1;
      return calls === 1
        ? json(200, {})
        : json(200, { state: "open", content: "# Canonical" });
    });
    await expect(tasks.updateBody("task-a", "# Requested")).resolves.toEqual({
      ok: true,
      id: "task-a",
      state: "open",
      content: "# Canonical",
    });
  });
});
