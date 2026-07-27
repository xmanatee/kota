/** Secrets namespace daemon transport and selector propagation tests. */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  SecretListEntry,
  SecretListResult,
  SecretScope,
} from "./client.js";
import secretsModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "request" | "requestStrict";
};

const ENCODING_SENSITIVE_NAME = "weird/name %value with space";

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "request" | "requestStrict",
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T | null> => {
      calls.push({ method, path, body, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body, shape: "requestStrict" });
      return responder(method, path, body, "requestStrict") as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("secrets module daemonClient(link)", () => {
  it("contributes a secrets namespace handler", () => {
    expect(secretsModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = secretsModule.daemonClient!(link);
    expect(contributed.secrets).toBeDefined();
    expect(typeof contributed.secrets!.list).toBe("function");
    expect(typeof contributed.secrets!.get).toBe("function");
    expect(typeof contributed.secrets!.set).toBe("function");
    expect(typeof contributed.secrets!.remove).toBe("function");
  });

  it("routes list() through strict GET /api/secrets", async () => {
    const expected: SecretListResult = { secrets: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/secrets",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("decodes a multi-entry SecretListResult payload mixing sources", async () => {
    const entries: SecretListEntry[] = [
      { name: "OPENAI_API_KEY", source: "project" },
      { name: "GITHUB_TOKEN", source: "global" },
      { name: "CUSTOM_TOKEN", source: "env" },
    ];
    const expected: SecretListResult = { secrets: entries };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.list();
    expect(result).toEqual(expected);
  });

  it("propagates a strict transport failure from list()", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new Error("daemon unavailable");
    });
    const contributed = secretsModule.daemonClient!(transport);
    await expect(contributed.secrets!.list()).rejects.toThrow("daemon unavailable");
  });

  it("routes get(name) through strict GET /api/secrets/:name with an encoded name", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({
      found: true,
      value: "the-value",
    }));
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.get(ENCODING_SENSITIVE_NAME);
    expect(result).toEqual({ found: true, value: "the-value" });
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/api/secrets/${encodeURIComponent(ENCODING_SENSITIVE_NAME)}`,
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("decodes the explicit absent result from get", async () => {
    const { transport } = makeRecordingTransport(() => ({ found: false }));
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.get("missing");
    expect(result).toEqual({ found: false });
  });

  it("routes set(name, value, scope) through strict PUT for both scopes", async () => {
    const scopes: SecretScope[] = ["project", "global"];
    for (const scope of scopes) {
      const { transport, calls } = makeRecordingTransport(() => ({ ok: true }));
      const contributed = secretsModule.daemonClient!(transport);
      const result = await contributed.secrets!.set(
        ENCODING_SENSITIVE_NAME,
        "the-value",
        scope,
      );
      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([
        {
          method: "PUT",
          path: `/api/secrets/${encodeURIComponent(ENCODING_SENSITIVE_NAME)}`,
          body: { value: "the-value", scope },
          shape: "requestStrict",
        },
      ]);
    }
  });

  it("collapses a thrown transport error from set into { ok: false, reason: 'store_error', message }", async () => {
    const { transport } = makeRecordingTransport((_method, _path, _body, shape) => {
      if (shape === "requestStrict") {
        throw new Error("store unwritable");
      }
      return null;
    });
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.set("name", "value", "project");
    expect(result).toEqual({
      ok: false,
      reason: "store_error",
      message: "store unwritable",
    });
  });

  it("routes remove(name, scope) through strict DELETE for both scopes", async () => {
    const scopes: SecretScope[] = ["project", "global"];
    for (const scope of scopes) {
      const { transport, calls } = makeRecordingTransport(() => ({ ok: true }));
      const contributed = secretsModule.daemonClient!(transport);
      const result = await contributed.secrets!.remove(
        ENCODING_SENSITIVE_NAME,
        scope,
      );
      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([
        {
          method: "DELETE",
          path: `/api/secrets/${encodeURIComponent(ENCODING_SENSITIVE_NAME)}?scope=${encodeURIComponent(scope)}`,
          body: undefined,
        shape: "requestStrict",
        },
      ]);
    }
  });

  it("decodes the explicit not_found result from remove", async () => {
    const { transport } = makeRecordingTransport(() => ({
      ok: false,
      reason: "not_found",
    }));
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.remove("missing", "project");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("collapses a thrown transport error from remove into { ok: false, reason: 'store_error', message }", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new Error("network exploded");
    });
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.remove("name", "project");
    expect(result).toEqual({
      ok: false,
      reason: "store_error",
      message: "network exploded",
    });
  });

  it("propagates project and scope selectors through every operation", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({
      secrets: [],
      found: false,
      ok: true,
    }));
    const contributed = secretsModule.daemonClient!(transport);

    await contributed.secrets!.list({ projectId: "project b" });
    await contributed.secrets!.get("TOKEN", { scopeId: "scope/b" });
    await contributed.secrets!.set("TOKEN", "value", "project", {
      projectId: "project b",
    });
    await contributed.secrets!.remove("TOKEN", "project", {
      scopeId: "scope/b",
    });

    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/secrets?projectId=project%20b",
        body: undefined,
        shape: "requestStrict",
      },
      {
        method: "GET",
        path: "/api/secrets/TOKEN?scopeId=scope%2Fb",
        body: undefined,
        shape: "requestStrict",
      },
      {
        method: "PUT",
        path: "/api/secrets/TOKEN?projectId=project%20b",
        body: { value: "value", scope: "project" },
        shape: "requestStrict",
      },
      {
        method: "DELETE",
        path: "/api/secrets/TOKEN?scope=project&scopeId=scope%2Fb",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("does not collapse unknown project rejections into store errors", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new Error("Unknown project: missing");
    });
    const contributed = secretsModule.daemonClient!(transport);

    await expect(
      contributed.secrets!.set("TOKEN", "value", "project", {
        projectId: "missing",
      }),
    ).rejects.toThrow("Unknown project: missing");
    await expect(
      contributed.secrets!.remove("TOKEN", "project", {
        projectId: "missing",
      }),
    ).rejects.toThrow("Unknown project: missing");
  });

  it("the assembly path fails loudly when the secrets module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.secrets;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /secrets/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the secrets module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = secretsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.secrets;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
