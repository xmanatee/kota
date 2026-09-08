import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import {
  makeWebhookChannelHandler,
  type WebhookChannelConfig,
  type WebhookHandlerContext,
  type WebhookSessionFactory,
} from "./handler.js";

export type CreatedWebhookSession = {
  label: string;
  autonomyMode: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

export function makeSessionFactory(
  created: CreatedWebhookSession[] = [],
): WebhookSessionFactory {
  return vi.fn(({ label, autonomyMode }) => {
    const send = vi.fn(async () => "agent response text");
    const close = vi.fn();
    created.push({ label, autonomyMode, send, close });
    return { send, close };
  });
}

export function makeStubCtx(
  bus?: EventBus,
  moduleConfig?: WebhookChannelConfig,
): WebhookHandlerContext & { getModuleConfig: () => WebhookChannelConfig } {
  const resolvedBus = bus ?? new EventBus();
  return {
    config: { serve: { defaultAutonomyMode: "supervised" } },
    getModuleConfig: () => moduleConfig ?? {},
    createSession: () => { throw new Error("Declare the agent session port for this scenario"); },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: makeStubEventProxy(resolvedBus),
  };
}

export type FakeResponse = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

function makeFakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(code, headers) {
      response.statusCode = code;
      if (headers) Object.assign(response.headers, headers);
    },
    end(body) {
      response.body = body ?? "";
    },
  };
  return response;
}

function makeFakeRequest(
  body: string,
  headers: Record<string, string>,
  url: string | undefined,
): IncomingMessage {
  const emitter = new EventEmitter();
  const request = Object.assign(emitter, {
    headers,
    method: "POST",
    url: url ?? "/api/channels/webhook",
  }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return request;
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;
}

export async function invokeHandler(
  ctx: ReturnType<typeof makeStubCtx>,
  body: string,
  headers: Record<string, string> = {},
  url?: string,
  sessionFactory: WebhookSessionFactory = makeSessionFactory(),
): Promise<FakeResponse> {
  const handler = makeWebhookChannelHandler(ctx, ctx.getModuleConfig() ?? {}, sessionFactory);
  const response = makeFakeResponse();
  await handler(
    makeFakeRequest(body, headers, url),
    response as unknown as ServerResponse,
  );
  return response;
}
