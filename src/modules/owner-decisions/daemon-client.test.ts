import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import ownerDecisionsModule from "./index.js";

function makeTransport(): { transport: DaemonTransport; requests: string[]; posts: Array<{ path: string; body: string | null }> } {
  const requests: string[] = [];
  const posts: Array<{ path: string; body: string | null }> = [];
  return {
    requests,
    posts,
    transport: {
      baseUrl: "http://127.0.0.1:0",
      authHeaders: () => ({}),
      request: async () => null,
      requestStrict: async <T>(_method: string, path: string): Promise<T> => {
        requests.push(path);
        return { decisions: [] } as T;
      },
      fetchRaw: async (path, init) => {
        requests.push(path);
        if (init?.method === "POST") {
          posts.push({ path, body: typeof init.body === "string" ? init.body : null });
          return new Response(JSON.stringify({ decision: { id: "d1", status: "answered" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ decision: { id: "d1", status: "pending" } }), { status: 200 });
      },
      events: async function* () {},
    },
  };
}

describe("owner-decisions daemon client", () => {
  it("contributes the ownerDecisions namespace", () => {
    const { transport } = makeTransport();
    const contributed = ownerDecisionsModule.daemonClient!(transport);
    expect(contributed.ownerDecisions).toBeDefined();
    const handlers = assembleDaemonClientHandlers(transport, {
      ...buildMigratedNamespaceTestStubs(),
      ownerDecisions: contributed.ownerDecisions!,
    });
    expect(handlers.ownerDecisions).toBe(contributed.ownerDecisions);
  });

  it("uses owner-decision daemon-control routes", async () => {
    const { transport, requests, posts } = makeTransport();
    const client = ownerDecisionsModule.daemonClient!(transport).ownerDecisions!;

    await client.list({ status: "all", projectId: "project-b" });
    await client.show("d/1", { projectId: "project-b" });
    await client.answer("d/1", { kind: "single-choice", optionId: "yes" }, { projectId: "project-b" });
    await client.cancel("d/1", "stale", { projectId: "project-b" });

    expect(requests).toEqual([
      "/owner-decisions?status=all&projectId=project-b",
      "/owner-decisions/d%2F1?projectId=project-b",
      "/owner-decisions/d%2F1/answer?projectId=project-b",
      "/owner-decisions/d%2F1/cancel?projectId=project-b",
    ]);
    expect(posts.map((post) => JSON.parse(post.body ?? "{}"))).toEqual([
      { selectedValue: { kind: "single-choice", optionId: "yes" } },
      { reason: "stale" },
    ]);
  });
});
