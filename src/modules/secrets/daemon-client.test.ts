/**
 * Secrets namespace daemon-side handler test.
 *
 * The secrets namespace migrated out of the core stub into
 * `daemonClient(link)` on the secrets module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The secrets module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `secrets` namespace.
 *  2. `list()` is wired through `DaemonTransport.request<T>` with method
 *     `GET`, path `/api/secrets`, and an undefined body. A `null`
 *     transport result collapses into `{ secrets: [] }`, matching the
 *     pre-migration central closure's `result?.secrets ?? []` fallback.
 *  3. `get(name)` is wired through `request<T>` with method `GET`, path
 *     `/api/secrets/${encodeURIComponent(name)}`, and an undefined body.
 *     A name containing reserved characters (`%`, `/`, space) round-trips
 *     through `encodeURIComponent` unchanged.
 *  4. `set(name, value, scope)` is wired through `requestStrict<T>` with
 *     method `PUT`, path `/api/secrets/${encodeURIComponent(name)}`, and
 *     body `{ value, scope }`. The same encoding-sensitive name and both
 *     scope arms (`project`, `global`) thread through unchanged.
 *  5. `remove(name, scope)` is wired through `request<T>` with method
 *     `DELETE`, path
 *     `/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
 *     and an undefined body. The same encoding-sensitive name and both
 *     scope arms thread through unchanged.
 *  6. `SecretListResult` decodes correctly through `request<T>` for both
 *     an empty payload and a multi-entry payload mixing sources.
 *  7. Both `SecretGetResult` arms decode correctly: a `200` `{ found:
 *     true, value }` payload collapses into `{ found: true, value }` and
 *     a `null` (404) response collapses into `{ found: false }`.
 *  8. Every `SecretMutateResult` arm decodes correctly: `200` `{ ok:
 *     true }` for set, `null` (404) for remove collapses into `{ ok:
 *     false, reason: "not_found" }`, and a thrown transport error from
 *     `requestStrict<T>` (set) or `request<T>` (remove) collapses into
 *     `{ ok: false, reason: "store_error", message }` with the
 *     underlying error message preserved.
 *  9. Removing the secrets module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "secrets" missing-handler
 *     error.
 * 10. Supplying the contribution to the assembly path satisfies coverage.
 */

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

  it("routes list() through GET /api/secrets via request<T> with no body", async () => {
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
        shape: "request",
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

  it("collapses a null transport result on list() into { secrets: [] }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.list();
    expect(result).toEqual({ secrets: [] });
  });

  it("routes get(name) through GET /api/secrets/:name via request<T> with encodeURIComponent and no body", async () => {
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
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from get into { found: false }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = secretsModule.daemonClient!(transport);
    const result = await contributed.secrets!.get("missing");
    expect(result).toEqual({ found: false });
  });

  it("routes set(name, value, scope) through PUT /api/secrets/:name via requestStrict<T> for both scope arms", async () => {
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

  it("routes remove(name, scope) through DELETE /api/secrets/:name?scope=... via request<T> for both scope arms", async () => {
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
          shape: "request",
        },
      ]);
    }
  });

  it("collapses a null (404) response from remove into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
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
