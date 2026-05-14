/**
 * Repo-tasks namespace daemon-side handler test.
 *
 * The tasks namespace migrated out of the core stub into `daemonClient(link)`
 * on the repo-tasks module. This test pins the invariants the migration
 * relies on:
 *
 *  1. The repo-tasks module exposes a `daemonClient(link)` factory that
 *     contributes `tasks` with all eight methods.
 *  2. `list(states)` GETs `/api/tasks` through `link.fetchRaw`, flattens the
 *     state-keyed body, and skips terminal `done`/`dropped` states. When
 *     the caller passes no states, it defaults to the four open states.
 *  3. `list` soft-fails on transport error and on non-ok response: it
 *     returns `{ tasks: [] }` rather than throwing.
 *  4. `show(id)` GETs `/api/tasks/<encodeURIComponent(id)>`. 404 collapses
 *     to `{ found: false }`; non-ok throws the daemon's `error` field;
 *     success returns `{ found: true, state, content }`.
 *  5. `move(id, toState)` PATCHes `/api/tasks/<id>/move` with body
 *     `{ state: toState }` and the JSON content-type header. 404 collapses
 *     to `not_found`; 409 to `already_in_state` with the response body's
 *     `state` (or `toState` when missing); other non-ok throws.
 *  6. `create(options)` POSTs `/api/tasks/normalized` with the full
 *     options body. 409 → `already_exists`; 400 → `invalid_slug`; non-ok
 *     throws; success returns `{ ok: true, id, path }`.
 *  7. `capture(title)` POSTs `/api/tasks/capture` with body `{ title }`.
 *     Same conflict and success arms as `create`.
 *  8. `gc(options)` POSTs `/api/tasks/gc` with `options ?? {}`. Non-ok
 *     throws; success returns the body verbatim.
 *  9. `search(query, filter)` GETs `/tasks/search?q=…` with `semantic`,
 *     `limit`, and `state` query params. Non-ok throws; success returns
 *     the body verbatim.
 * 10. `reindex()` POSTs `/tasks/reindex`. Non-ok throws; success returns
 *     the body verbatim.
 * 11. Supplying the contribution to the assembly path satisfies coverage.
 * 12. Removing the repo-tasks module's contribution makes the assembled
 *     client fail loudly with a clear "tasks" missing-handler error.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import repoTasksModule from "./index.js";

type RecordedFetchRaw = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(opts: {
  fetchRaw?: FetchResponder;
}): { transport: DaemonTransport; calls: RecordedFetchRaw[] } {
  const calls: RecordedFetchRaw[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      if (!opts.fetchRaw) {
        throw new Error("fetchRaw responder not configured");
      }
      return opts.fetchRaw(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("repo-tasks module daemonClient(link) — tasks namespace", () => {
  it("contributes a tasks namespace handler with eight methods", () => {
    expect(repoTasksModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = repoTasksModule.daemonClient!(transport);
    expect(contributed.tasks).toBeDefined();
    const tasks = contributed.tasks!;
    expect(typeof tasks.list).toBe("function");
    expect(typeof tasks.show).toBe("function");
    expect(typeof tasks.move).toBe("function");
    expect(typeof tasks.create).toBe("function");
    expect(typeof tasks.capture).toBe("function");
    expect(typeof tasks.gc).toBe("function");
    expect(typeof tasks.search).toBe("function");
    expect(typeof tasks.reindex).toBe("function");
  });

  it("list flattens the state-keyed body and defaults to the four open states", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () =>
        jsonResponse(200, {
          counts: { backlog: 1, ready: 1, doing: 0, blocked: 0, done: 1, dropped: 0 },
          tasks: {
            backlog: [
              { id: "b1", title: "B-One", priority: "p1", area: "a", summary: "", body: "" },
            ],
            ready: [
              { id: "r1", title: "R-One", priority: "p2", area: "a", summary: "", body: "" },
            ],
            doing: [],
            blocked: [],
            done: [
              { id: "d1", title: "D-One", priority: "p3", area: "a", summary: "", body: "" },
            ],
            dropped: [],
          },
        }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.list();
    expect(result).toEqual({
      tasks: [
        { id: "b1", title: "B-One", priority: "p1", state: "backlog" },
        { id: "r1", title: "R-One", priority: "p2", state: "ready" },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/tasks");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("list skips terminal states even when the caller asks for them", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () =>
        jsonResponse(200, {
          counts: {},
          tasks: {
            done: [{ id: "d1", title: "D", priority: "p2", area: "a", summary: "", body: "" }],
            dropped: [{ id: "x1", title: "X", priority: "p2", area: "a", summary: "", body: "" }],
            ready: [{ id: "r1", title: "R", priority: "p2", area: "a", summary: "", body: "" }],
          },
        }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.list(["done", "dropped", "ready"]);
    expect(result.tasks.map((t) => t.id)).toEqual(["r1"]);
  });

  it("list soft-fails on non-ok response (returns { tasks: [] })", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(500, { error: "boom" }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.list();
    expect(result).toEqual({ tasks: [] });
  });

  it("list soft-fails on transport error (fetchRaw throws)", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () => {
        throw new Error("network down");
      },
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.list();
    expect(result).toEqual({ tasks: [] });
  });

  it("show GETs /api/tasks/<id> and decodes the success arm", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { state: "ready", content: "task body" }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.show("task-foo bar");
    expect(result).toEqual({ found: true, state: "ready", content: "task body" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/tasks/task-foo%20bar");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("show returns { found: false } on 404 and throws the daemon's error on other non-ok", async () => {
    const { transport: t404 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(404, { error: "missing" }),
    });
    const c404 = repoTasksModule.daemonClient!(t404);
    expect(await c404.tasks!.show("missing")).toEqual({ found: false });

    const { transport: t500 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(500, { error: "broken" }),
    });
    const c500 = repoTasksModule.daemonClient!(t500);
    await expect(c500.tasks!.show("any")).rejects.toThrow(/broken/);
  });

  it("move PATCHes /api/tasks/<id>/move with the JSON state body", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () =>
        jsonResponse(200, {
          id: "t1",
          fromState: "ready",
          toState: "doing",
          path: "data/tasks/doing/t1.md",
          previousPath: "data/tasks/ready/t1.md",
        }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.move("t1", "doing");
    expect(result).toEqual({
      ok: true,
      id: "t1",
      fromState: "ready",
      toState: "doing",
      path: "data/tasks/doing/t1.md",
      previousPath: "data/tasks/ready/t1.md",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/tasks/t1/move");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect((calls[0]!.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ state: "doing" });
  });

  it("move decodes 404 → not_found and 409 → already_in_state", async () => {
    const { transport: t404 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(404, {}),
    });
    expect(
      await repoTasksModule.daemonClient!(t404).tasks!.move("missing", "ready"),
    ).toEqual({ ok: false, reason: "not_found" });

    const { transport: t409 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(409, { state: "doing" }),
    });
    expect(
      await repoTasksModule.daemonClient!(t409).tasks!.move("t1", "ready"),
    ).toEqual({ ok: false, reason: "already_in_state", state: "doing" });

    const { transport: t409Empty } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(409, {}),
    });
    expect(
      await repoTasksModule.daemonClient!(t409Empty).tasks!.move("t1", "blocked"),
    ).toEqual({ ok: false, reason: "already_in_state", state: "blocked" });
  });

  it("create POSTs /api/tasks/normalized and decodes 200/409/400", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { id: "t1", path: "data/tasks/ready/t1.md" }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.create({
      title: "Hello",
      priority: "p2",
      area: "core",
      state: "ready",
    });
    expect(result).toEqual({ ok: true, id: "t1", path: "data/tasks/ready/t1.md" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/tasks/normalized");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      title: "Hello",
      priority: "p2",
      area: "core",
      state: "ready",
    });

    const { transport: t409 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(409, { error: "exists" }),
    });
    expect(
      await repoTasksModule.daemonClient!(t409).tasks!.create({
        title: "Hello",
        priority: "p2",
        area: "core",
        state: "ready",
      }),
    ).toEqual({ ok: false, reason: "already_exists", message: "exists" });

    const { transport: t400 } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(400, { error: "bad slug" }),
    });
    expect(
      await repoTasksModule.daemonClient!(t400).tasks!.create({
        title: "Hello",
        priority: "p2",
        area: "core",
        state: "ready",
      }),
    ).toEqual({ ok: false, reason: "invalid_slug", message: "bad slug" });
  });

  it("project-scoped create sends projectId in the query, not the JSON body", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { id: "t1", path: "data/tasks/ready/t1.md" }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    await contributed.tasks!.create({
      title: "Hello",
      priority: "p2",
      area: "core",
      state: "ready",
      projectId: "project-a",
    });
    expect(calls[0]!.path).toBe("/api/tasks/normalized?projectId=project-a");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      title: "Hello",
      priority: "p2",
      area: "core",
      state: "ready",
    });
  });

  it("capture POSTs /api/tasks/capture with the title body", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { id: "inb", path: "data/inbox/inb.md" }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.capture("Quick thought");
    expect(result).toEqual({ ok: true, id: "inb", path: "data/inbox/inb.md" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/tasks/capture");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ title: "Quick thought" });
  });

  it("gc POSTs /api/tasks/gc with options and returns the body verbatim", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { archived: ["a"], deleted: ["d"] }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.gc({ days: 30, dryRun: true });
    expect(result).toEqual({ archived: ["a"], deleted: ["d"] });
    expect(calls[0]!.path).toBe("/api/tasks/gc");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ days: 30, dryRun: true });

    const { transport: tNoOpts } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { archived: [], deleted: [] }),
    });
    await repoTasksModule.daemonClient!(tNoOpts).tasks!.gc();
  });

  it("search GETs /tasks/search with q/semantic/limit/state params", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { ok: true, tasks: [] }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.search("query terms", {
      semantic: false,
      limit: 5,
      states: ["ready", "doing"],
    });
    expect(result).toEqual({ ok: true, tasks: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(
      "/tasks/search?q=query+terms&semantic=false&limit=5&state=ready&state=doing",
    );
  });

  it("project-scoped search and reindex append projectId to their query strings", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { ok: true, tasks: [] }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    await contributed.tasks!.search("query terms", {
      semantic: false,
      projectId: "project-a",
    });
    expect(calls[0]!.path).toBe(
      "/tasks/search?q=query+terms&semantic=false&projectId=project-a",
    );

    const { transport: reindexTransport, calls: reindexCalls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { indexed: 1, failed: 0 }),
    });
    const reindexClient = repoTasksModule.daemonClient!(reindexTransport);
    await reindexClient.tasks!.reindex({ projectId: "project-a" });
    expect(reindexCalls[0]!.path).toBe("/tasks/reindex?projectId=project-a");
  });

  it("reindex POSTs /tasks/reindex and returns the body verbatim", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { indexed: 7, failed: 1 }),
    });
    const contributed = repoTasksModule.daemonClient!(transport);
    const result = await contributed.tasks!.reindex();
    expect(result).toEqual({ indexed: 7, failed: 1 });
    expect(calls[0]!.path).toBe("/tasks/reindex");
    expect(calls[0]!.init?.method).toBe("POST");
  });

  it("supplying the tasks contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = repoTasksModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.tasks;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the tasks contribution is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.tasks;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /tasks/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
