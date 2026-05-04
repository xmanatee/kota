/**
 * Webhook namespace daemon-side handler test.
 *
 * The webhook namespace migrated out of the core stub into
 * `daemonClient(link)` on the webhook module. This test pins the invariants
 * the migration relies on:
 *
 *  1. The webhook module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `webhook` namespace.
 *  2. `list()` is wired through `DaemonTransport.requestStrict<T>` with
 *     method `GET`, path `/webhooks`, and an undefined body — the byte-for-
 *     byte shape today's wire code emits.
 *  3. `secretGenerate(workflow)` is wired through `requestStrict<T>` with
 *     method `POST`, path `/webhooks/${encodeURIComponent(workflow)}/secret`,
 *     and an undefined body. A workflow id containing reserved characters
 *     (`%`, `/`, space) round-trips through the encoding unchanged.
 *  4. `secretRemove(workflow)` is wired through `requestStrict<T>` with
 *     method `DELETE`, path `/webhooks/${encodeURIComponent(workflow)}/secret`,
 *     and an undefined body. The same encoding-sensitive workflow id
 *     round-trips unchanged.
 *  5. Every `WebhookListResult` payload decodes through `requestStrict<T>`
 *     unchanged — empty entries plus a multi-entry payload mixing
 *     `hasSecret: true` and `hasSecret: false`.
 *  6. Every `WebhookSecretGenerateResult` arm (`overwrote: false` and
 *     `overwrote: true`) decodes unchanged.
 *  7. Every `WebhookSecretRemoveResult` arm (`removed: true` and
 *     `removed: false`) decodes unchanged.
 *  8. Removing the webhook module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "webhook" missing-handler
 *     error.
 *  9. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  WebhookListResult,
  WebhookSecretGenerateResult,
  WebhookSecretRemoveResult,
} from "./client.js";
import webhookModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
};

const ENCODING_SENSITIVE_WORKFLOW = "weird/flow %name with space";

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body });
      return responder(method, path, body) as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("webhook module daemonClient(link)", () => {
  it("contributes a webhook namespace handler", () => {
    expect(webhookModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = webhookModule.daemonClient!(link);
    expect(contributed.webhook).toBeDefined();
    expect(typeof contributed.webhook!.list).toBe("function");
    expect(typeof contributed.webhook!.secretGenerate).toBe("function");
    expect(typeof contributed.webhook!.secretRemove).toBe("function");
  });

  it("routes list() through GET /webhooks with no body", async () => {
    const expected: WebhookListResult = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "GET", path: "/webhooks", body: undefined },
    ]);
  });

  it("routes secretGenerate(workflow) through POST /webhooks/:workflow/secret with encodeURIComponent and no body", async () => {
    const expected: WebhookSecretGenerateResult = {
      workflow: ENCODING_SENSITIVE_WORKFLOW,
      secret: "deadbeef",
      overwrote: false,
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretGenerate(
      ENCODING_SENSITIVE_WORKFLOW,
    );
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: `/webhooks/${encodeURIComponent(ENCODING_SENSITIVE_WORKFLOW)}/secret`,
        body: undefined,
      },
    ]);
  });

  it("routes secretRemove(workflow) through DELETE /webhooks/:workflow/secret with encodeURIComponent and no body", async () => {
    const expected: WebhookSecretRemoveResult = {
      ok: true,
      workflow: ENCODING_SENSITIVE_WORKFLOW,
      removed: true,
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretRemove(
      ENCODING_SENSITIVE_WORKFLOW,
    );
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: `/webhooks/${encodeURIComponent(ENCODING_SENSITIVE_WORKFLOW)}/secret`,
        body: undefined,
      },
    ]);
  });

  it("decodes a multi-entry WebhookListResult payload mixing hasSecret arms", async () => {
    const expected: WebhookListResult = {
      entries: [
        { workflow: "first", hasSecret: true },
        { workflow: "second", hasSecret: false },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.list();
    expect(result).toEqual(expected);
  });

  it("decodes a WebhookSecretGenerateResult with overwrote: false", async () => {
    const expected: WebhookSecretGenerateResult = {
      workflow: "fresh-flow",
      secret: "freshsecret",
      overwrote: false,
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretGenerate("fresh-flow");
    expect(result).toEqual(expected);
  });

  it("decodes a WebhookSecretGenerateResult with overwrote: true", async () => {
    const expected: WebhookSecretGenerateResult = {
      workflow: "rotated-flow",
      secret: "rotatedsecret",
      overwrote: true,
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretGenerate("rotated-flow");
    expect(result).toEqual(expected);
  });

  it("decodes a WebhookSecretRemoveResult with removed: true", async () => {
    const expected: WebhookSecretRemoveResult = {
      ok: true,
      workflow: "removed-flow",
      removed: true,
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretRemove("removed-flow");
    expect(result).toEqual(expected);
  });

  it("decodes a WebhookSecretRemoveResult with removed: false", async () => {
    const expected: WebhookSecretRemoveResult = {
      ok: true,
      workflow: "absent-flow",
      removed: false,
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = webhookModule.daemonClient!(transport);
    const result = await contributed.webhook!.secretRemove("absent-flow");
    expect(result).toEqual(expected);
  });

  it("the assembly path fails loudly when the webhook module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.webhook;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /webhook/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the webhook module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = webhookModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.webhook;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
