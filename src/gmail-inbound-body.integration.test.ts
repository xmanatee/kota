import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { makeGmailGetMessage } from "#modules/google-workspace/gmail.js";
import googleWorkspaceModule from "#modules/google-workspace/index.js";
import { type InboundSignalReceivedPayload, inboundSignalReceived, inboundSignalWorkflowTargeted } from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";

// Catches loss or substitution of body availability between the Gmail route,
// typed event and workflow enqueue payload. MIME combinations belong to decoder tests.
describe("Gmail body availability through inbound workflow dispatch", () => {
  it.each([false, true])("propagates body text and limitations (unavailable: %s)", async (unavailable) => {
    const stored = { mimeType: "text/plain", body: { attachmentId: "stored-body" } };
    const message = {
      id: "delivery", threadId: "thread", internalDate: "1779680040000",
      snippet: "Old excerpt Tuesday",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "Alice <alice@example.com>" }],
        parts: unavailable ? [stored] : [
          { mimeType: "text/plain", filename: "old.txt", body: { data: Buffer.from("Attachment Tuesday").toString("base64url") } },
          { mimeType: "text/plain", body: { data: Buffer.from("Delivery Thursday").toString("base64url") } },
          stored,
        ],
      },
    };
    const tool = makeGmailGetMessage(async () => "fixture-token", "me",
      outboundHttpRequestPort(() => Response.json(message)));
    const read = await tool.runner({ id: message.id });
    const bus = new EventBus();
    const emitted: InboundSignalReceivedPayload[] = [];
    bus.on(inboundSignalReceived, (signal) => { emitted.push(signal); });
    const ctx = {
      cwd: process.cwd(), events: makeStubEventProxy(bus),
      getModuleConfig: () => ({
        clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture",
        inbound: { accountId: "owner@example.com", trustedSenders: ["alice@example.com"] },
      }),
    } as unknown as ModuleRuntimeContext;
    const route = googleWorkspaceModule.routes?.(ctx).find((r) => r.path.endsWith("/gmail"));
    if (!route) throw new Error("Gmail route missing");
    let status = 0;
    const res = { setHeader() {}, writeHead(code: number) { status = code; }, end() {} } as unknown as ServerResponse;
    await route.handler(Readable.from([Buffer.from(JSON.stringify(message))]) as IncomingMessage, res, {});
    expect(status).toBe(200);
    expect(emitted).toHaveLength(1);
    const signal = emitted[0]!;
    expect(signal).toMatchObject({
      scopeId: deriveDirectoryScopeId(ctx.cwd), accountId: "google:gmail:owner@example.com",
      sourceId: "google:gmail:owner@example.com", externalId: "gmail:delivery",
      occurredAt: "2026-05-25T03:34:00.000Z", actor: { trust: "trusted", id: "google:gmail:alice@example.com" },
    });
    if (signal.body.kind !== "message") throw new Error("Expected message body");
    const label = unavailable ? "Message body unavailable" : "Message body partial";
    for (const text of [read.content, signal.body.text]) {
      expect(text).toContain(label);
      expect(text).toContain("stored separately");
      expect(text).not.toContain("Attachment Tuesday");
      if (unavailable) {
        expect(text).toContain("excerpt only");
        expect(text).toContain("Old excerpt Tuesday");
      } else {
        expect(text).toContain("Delivery Thursday");
        expect(text).not.toContain("Tuesday");
      }
    }
    expect(read.is_error).toBe(unavailable ? true : undefined);
    const queued: unknown[] = [];
    const result = await dispatchInboundSignalRoute({
      signal,
      config: { routes: [{ id: "capture", provider: "google-workspace", channel: "gmail.message", sourceId: signal.sourceId, targets: [{ kind: "workflow", name: "capture" }] }] },
      context: { workflowNames: new Set(["capture"]), agentNames: new Set() },
      deps: {
        async triggerWorkflow(name, options) {
          queued.push(options);
          return { ok: true, path: "daemon", queued: name, runId: "fixture-run" };
        },
        emitRouted() {},
      },
    });
    expect(result.decision).toBe("dispatched");
    expect(queued).toEqual([expect.objectContaining({ event: inboundSignalWorkflowTargeted, payload: expect.objectContaining({ signal, actorTrust: "trusted" }) })]);
  });
});
