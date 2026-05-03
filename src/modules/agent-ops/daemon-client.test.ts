/**
 * Agents namespace daemon-side handler test.
 *
 * The agents namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the agent-ops module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The agent-ops module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `agents` namespace with both
 *     `list` and `inspect` methods.
 *  2. `list()` is wired through `requestStrict<T>` — calling `list` issues
 *     a single `GET /agents` with no query string and no body.
 *  3. A successful `{ agents: AgentSummary[] }` response decodes verbatim.
 *  4. `inspect(name)` is wired through `requestStrict<T>` — calling
 *     `inspect` issues a single `GET /agents/{encodeURIComponent(name)}`
 *     with no body.
 *  5. A successful `{ found: true; agent }` response decodes verbatim.
 *  6. A `{ found: false }` response decodes verbatim — the strict-transport
 *     posture replaces the previous `404 → typed result` special-case.
 *  7. `requestStrict<T>` failures on either method propagate rather than
 *     being silently swallowed.
 *  8. Removing the agent-ops module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "agents" missing-handler
 *     error; supplying the contribution satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  AgentInspectResult,
  AgentSummary,
  AgentsListResult,
} from "./client.js";
import agentsModule from "./index.js";

type RecordedRequestStrict = {
  kind: "requestStrict";
  method: string;
  path: string;
  body: unknown;
};

function makeRecordingTransport(options: {
  requestStrictResponder?: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown;
}): { transport: DaemonTransport; calls: RecordedRequestStrict[] } {
  const calls: RecordedRequestStrict[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ kind: "requestStrict", method, path, body });
      if (!options.requestStrictResponder) {
        throw new Error("unexpected requestStrict call");
      }
      return options.requestStrictResponder(method, path, body) as T;
    },
    fetchRaw: async (): Promise<Response> => {
      throw new Error("unexpected fetchRaw call");
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function makeAgentSummary(name: string): AgentSummary {
  return {
    name,
    source: "agent-ops",
    role: "operator",
    model: "claude-opus-4-7",
    promptPath: `src/modules/${name}/prompt.md`,
    writeScope: [],
  };
}

describe("agent-ops module daemonClient(link)", () => {
  it("contributes an agents namespace handler with both methods", () => {
    expect(agentsModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = agentsModule.daemonClient!(transport);
    expect(contributed.agents).toBeDefined();
    expect(typeof contributed.agents!.list).toBe("function");
    expect(typeof contributed.agents!.inspect).toBe("function");
  });

  it("routes list through GET /agents with no body", async () => {
    const expected: AgentsListResult = { agents: [] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = agentsModule.daemonClient!(transport);
    const result = await contributed.agents!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/agents",
        body: undefined,
      },
    ]);
  });

  it("decodes a successful { agents: AgentSummary[] } response verbatim", async () => {
    const summaries: AgentSummary[] = [
      makeAgentSummary("builder"),
      {
        ...makeAgentSummary("critic"),
        effort: "xhigh",
        skills: ["repo-knowledge"],
        tools: { allowed: ["file_read"] },
      },
    ];
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => ({ agents: summaries }),
    });
    const contributed = agentsModule.daemonClient!(transport);
    const result = await contributed.agents!.list();
    expect(result).toEqual({ agents: summaries });
  });

  it("propagates list HTTP failures rather than silently returning an empty list", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = agentsModule.daemonClient!(transport);
    await expect(contributed.agents!.list()).rejects.toThrow(/boom/);
  });

  it("routes inspect through GET /agents/{encodeURIComponent(name)} with no body", async () => {
    const summary = makeAgentSummary("builder");
    const expected: AgentInspectResult = { found: true, agent: summary };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = agentsModule.daemonClient!(transport);
    const result = await contributed.agents!.inspect("builder");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/agents/builder",
        body: undefined,
      },
    ]);
  });

  it("URL-encodes the name segment when inspect is called with a special-character name", async () => {
    const expected: AgentInspectResult = { found: false };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = agentsModule.daemonClient!(transport);
    await contributed.agents!.inspect("name with/slash");
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/agents/name%20with%2Fslash",
        body: undefined,
      },
    ]);
  });

  it("decodes a successful { found: true; agent } response verbatim", async () => {
    const summary: AgentSummary = {
      ...makeAgentSummary("decomposer"),
      effort: "high",
      skills: "all",
    };
    const expected: AgentInspectResult = { found: true, agent: summary };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = agentsModule.daemonClient!(transport);
    const result = await contributed.agents!.inspect("decomposer");
    expect(result).toEqual(expected);
  });

  it("decodes a { found: false } response verbatim", async () => {
    const expected: AgentInspectResult = { found: false };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = agentsModule.daemonClient!(transport);
    const result = await contributed.agents!.inspect("missing");
    expect(result).toEqual(expected);
  });

  it("propagates inspect transport failures rather than masquerading as { found: false }", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = agentsModule.daemonClient!(transport);
    await expect(contributed.agents!.inspect("any")).rejects.toThrow(/boom/);
  });

  it("the assembly path fails loudly when the agent-ops module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.agents;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /agents/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the agent-ops module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = agentsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.agents;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
