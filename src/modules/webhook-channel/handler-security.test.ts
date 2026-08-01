import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { clearSessions } from "./handler.js";
import {
  type CreatedWebhookSession,
  invokeHandler,
  makeSessionFactory,
  makeStubCtx,
  sign,
} from "./handler-test-support.integration.js";

beforeEach(clearSessions);

describe("webhook handler HMAC verification", () => {
  const secret = "webhook-test-secret";

  it("accepts valid signatures and rejects missing or invalid signatures", async () => {
    const body = JSON.stringify({ message: "Signed payload" });
    const valid = await invokeHandler(makeStubCtx(undefined, { secret }), body, {
      "x-webhook-signature": sign(secret, body),
    });
    expect(valid.statusCode).toBe(201);
    expect(JSON.parse(valid.body!).response).toBe("agent response text");

    const missing = await invokeHandler(makeStubCtx(undefined, { secret }), body);
    expect(missing.statusCode).toBe(401);
    expect(JSON.parse(missing.body!).error).toContain("Missing");

    const invalid = await invokeHandler(makeStubCtx(undefined, { secret }), body, {
      "x-webhook-signature": sign("wrong-secret", body),
    });
    expect(invalid.statusCode).toBe(401);
    expect(JSON.parse(invalid.body!).error).toContain("Invalid signature");
  });

  it("supports environment secret references", async () => {
    const envKey = "KOTA_TEST_WH_SECRET_12345";
    process.env[envKey] = "env-resolved-secret";
    try {
      const body = JSON.stringify({ message: "Env secret" });
      const response = await invokeHandler(
        makeStubCtx(undefined, { secret: `$${envKey}` }),
        body,
        { "x-webhook-signature": sign("env-resolved-secret", body) },
      );
      expect(response.statusCode).toBe(201);
    } finally {
      delete process.env[envKey];
    }
  });
});

describe("webhook handler session state", () => {
  it("resumes an existing session and rejects an unknown id", async () => {
    const ctx = makeStubCtx();
    const created = await invokeHandler(ctx, JSON.stringify({ message: "First" }));
    const sessionId = JSON.parse(created.body!).sessionId;
    const resumed = await invokeHandler(
      ctx,
      JSON.stringify({ message: "Follow-up", sessionId }),
    );
    expect(resumed.statusCode).toBe(200);
    expect(JSON.parse(resumed.body!).sessionId).toBe(sessionId);

    const missing = await invokeHandler(
      ctx,
      JSON.stringify({ message: "Resume unknown", sessionId: "wh-nonexistent" }),
    );
    expect(missing.statusCode).toBe(404);
  });

  it("includes metadata in new-session prompts and emits the session event", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("webhook-channel.session", (payload) => received.push(payload));
    const created: CreatedWebhookSession[] = [];
    await invokeHandler(
      makeStubCtx(bus),
      JSON.stringify({
        message: "Deploy complete",
        metadata: { service: "api", env: "production" },
      }),
      {},
      undefined,
      makeSessionFactory(created),
    );
    expect(created[0].send).toHaveBeenCalledWith(expect.stringContaining("production"));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ resumed: false });
  });
});
