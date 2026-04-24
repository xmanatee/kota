import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import type { MessageStream, ModelClient } from "#core/model/model-client.js";
import { FailoverModelClient } from "./failover-client.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
}));

function makeMockClient(label: string): ModelClient {
  const msg: KotaModelResponse = {
    id: `msg-${label}`,
    role: "assistant",
    content: [{ type: "text", text: `response from ${label}` }],
    model: `model-${label}`,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
  return {
    messages: {
      stream: vi.fn(() => {
        const stream = {
          on: vi.fn().mockReturnThis(),
          finalMessage: vi.fn().mockResolvedValue(msg),
        } as unknown as MessageStream;
        return stream;
      }),
      create: vi.fn().mockResolvedValue(msg),
    },
  };
}

function makeFailingClient(): ModelClient {
  return {
    messages: {
      stream: vi.fn(() => {
        const stream = {
          on: vi.fn().mockReturnThis(),
          finalMessage: vi.fn().mockRejectedValue(new Error("API error 500")),
        } as unknown as MessageStream;
        return stream;
      }),
      create: vi.fn().mockRejectedValue(new Error("API error 500")),
    },
  };
}

function makeFailoverClient(opts?: {
  primary?: ModelClient;
  fallback?: ModelClient;
  errorThreshold?: number;
  cooldownMs?: number;
}): FailoverModelClient {
  return new FailoverModelClient({
    primary: opts?.primary ?? makeMockClient("primary"),
    fallback: opts?.fallback ?? makeMockClient("fallback"),
    primaryName: "anthropic",
    fallbackName: "openai",
    errorThreshold: opts?.errorThreshold ?? 3,
    windowMs: 60_000,
    cooldownMs: opts?.cooldownMs ?? 10_000,
  });
}

const createParams = {
  model: "test",
  max_tokens: 100,
  messages: [{ role: "user" as const, content: "hi" }],
};

const streamParams = {
  model: "test",
  max_tokens: 100,
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("FailoverModelClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("healthy path (no failover)", () => {
    it("delegates create to primary", async () => {
      const primary = makeMockClient("primary");
      const client = makeFailoverClient({ primary });
      const result = await client.messages.create(createParams);
      expect(result.id).toBe("msg-primary");
      expect(primary.messages.create).toHaveBeenCalledWith(createParams);
    });

    it("delegates stream to primary", async () => {
      const primary = makeMockClient("primary");
      const client = makeFailoverClient({ primary });
      const stream = client.messages.stream(streamParams);
      const msg = await stream.finalMessage();
      expect(msg.id).toBe("msg-primary");
    });

    it("health state is healthy", () => {
      const client = makeFailoverClient();
      expect(client.getHealthState().status).toBe("healthy");
    });
  });

  describe("failover trigger", () => {
    it("fails over to fallback after error threshold on create", async () => {
      const failing = makeFailingClient();
      const fallback = makeMockClient("fallback");
      const client = makeFailoverClient({
        primary: failing,
        fallback,
        errorThreshold: 2,
      });

      await expect(client.messages.create(createParams)).rejects.toThrow();
      await expect(client.messages.create(createParams)).rejects.toThrow();

      expect(client.getHealthState().status).toBe("unhealthy");

      const result = await client.messages.create(createParams);
      expect(result.id).toBe("msg-fallback");
    });

    it("fails over to fallback after error threshold on stream", async () => {
      const failing = makeFailingClient();
      const fallback = makeMockClient("fallback");
      const client = makeFailoverClient({
        primary: failing,
        fallback,
        errorThreshold: 2,
      });

      const s1 = client.messages.stream(streamParams);
      await expect(s1.finalMessage()).rejects.toThrow();
      const s2 = client.messages.stream(streamParams);
      await expect(s2.finalMessage()).rejects.toThrow();

      const s3 = client.messages.stream(streamParams);
      const msg = await s3.finalMessage();
      expect(msg.id).toBe("msg-fallback");
    });
  });

  describe("recovery", () => {
    it("probes primary after cooldown and recovers on success", async () => {
      const controllable = makeMockClient("primary");
      const fallback = makeMockClient("fallback");
      const client = new FailoverModelClient({
        primary: controllable,
        fallback,
        primaryName: "anthropic",
        fallbackName: "openai",
        errorThreshold: 1,
        windowMs: 60_000,
        cooldownMs: 5_000,
      });

      (controllable.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
      await expect(client.messages.create(createParams)).rejects.toThrow();
      expect(client.getHealthState().status).toBe("unhealthy");

      vi.advanceTimersByTime(5_000);

      const result = await client.messages.create(createParams);
      expect(result.id).toBe("msg-primary");
      expect(client.getHealthState().status).toBe("healthy");
    });
  });

  describe("single-provider config", () => {
    it("passes through without failover when primary is healthy", async () => {
      const primary = makeMockClient("primary");
      const client = makeFailoverClient({ primary });

      for (let i = 0; i < 10; i++) {
        const result = await client.messages.create(createParams);
        expect(result.id).toBe("msg-primary");
      }
      expect(client.getHealthState().status).toBe("healthy");
    });
  });
});
