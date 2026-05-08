/**
 * Projects namespace daemon-side handler test.
 *
 * Pins the wire shape `daemonClient(link)` produces for the `projects`
 * namespace:
 *
 *  1. Module exposes a `projects` handler with `list` and `use` methods.
 *  2. `list()` is a `GET /projects` call with auth headers and decodes
 *     a 200 response into `{ ok: true, projects, defaultProjectId,
 *     activeProjectId }`.
 *  3. `list()` collapses transport failures into `daemon_required`.
 *  4. `use(id)` is a `PATCH /projects/active` call with body
 *     `{ projectId }` and decodes a 200 into `{ ok: true,
 *     activeProjectId }`.
 *  5. `use(null)` clears the selection through the same wire path.
 *  6. `use(id)` decodes a 404 into the typed `not_found` arm,
 *     preserving the daemon-supplied projectId.
 *  7. `use(id)` collapses transport failures into `daemon_required`.
 *  8. The contribution satisfies the assembly coverage check; removing
 *     it makes assembly fail loudly with the namespace name.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import daemonOpsModule from "./index.js";

type RecordedCall = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(responder: FetchResponder): {
  transport: DaemonTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      return responder(path, init);
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

describe("daemon-ops module daemonClient(link) — projects namespace", () => {
  it("contributes a projects namespace handler", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const contributed = daemonOpsModule.daemonClient!(transport);
    expect(contributed.projects).toBeDefined();
    expect(typeof contributed.projects!.list).toBe("function");
    expect(typeof contributed.projects!.use).toBe("function");
  });

  it("routes list() through GET /projects with auth headers and decodes the success arm", async () => {
    const wireBody = {
      defaultProjectId: "p1",
      activeProjectId: "p2" as string | null,
      projects: [
        { projectId: "p1", projectDir: "/tmp/p1", displayName: "p1" },
        { projectId: "p2", projectDir: "/tmp/p2", displayName: "p2" },
      ],
    };
    const { transport, calls } = makeRecordingTransport(() => jsonResponse(200, wireBody));
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.list();
    expect(result).toEqual({
      ok: true,
      projects: wireBody.projects,
      defaultProjectId: "p1",
      activeProjectId: "p2",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/projects");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("list() decodes the daemon_required arm on transport failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.list();
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("routes use(id) through PATCH /projects/active with the projectId in the body", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { activeProjectId: "p2" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.use("p2");
    expect(result).toEqual({ ok: true, activeProjectId: "p2" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/projects/active");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect(calls[0]!.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ projectId: "p2" });
  });

  it("use(null) clears the active selection through the same wire path", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { activeProjectId: null }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.use(null);
    expect(result).toEqual({ ok: true, activeProjectId: null });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ projectId: null });
  });

  it("use(id) decodes the not_found arm on a 404 response", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(404, {
        error: "Unknown project",
        reason: "unknown_project",
        projectId: "ghost",
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.use("ghost");
    expect(result).toEqual({ ok: false, reason: "not_found", projectId: "ghost" });
  });

  it("use(id) decodes the daemon_required arm on transport failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.projects!.use("p1");
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("supplying the projects contribution satisfies assembly coverage", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const contributed = daemonOpsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.projects;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the projects contribution is removed", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const others = buildMigratedNamespaceTestStubs();
    delete others.projects;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(/projects/);
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
