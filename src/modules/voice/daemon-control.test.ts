/**
 * Exercises the voice module's daemon-control routes through the same
 * registration seam the real daemon uses: `voiceControlRoutes()` is the
 * module's contribution, so the test mounts those handlers on a live
 * `DaemonControlServer` and hits `/voice/transcribe` and
 * `/voice/synthesize` via HTTP. No test-only production flags.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { TRANSCRIPTION_PROVIDER_TYPE } from "#modules/transcription/types.js";
import { voiceControlRoutes } from "./routes.js";
import {
  SPEECH_SYNTHESIS_PROVIDER_TYPE,
  type SpeechSynthesisProvider,
  type SpeechToTextProvider,
} from "./types.js";

const TEST_TOKEN = "voice-test-token";

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    })),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    triggerWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] })),
    registerPushToken: vi.fn(),
  };
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function postRaw(
  port: number,
  path: string,
  raw: string,
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: raw,
  });
}

describe("voice module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;

  beforeEach(async () => {
    resetProviderRegistry();
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: voiceControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetProviderRegistry();
  });

  describe("registration seam", () => {
    it("declares /voice/* routes with control capability scope", () => {
      const routes = voiceControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /voice/transcribe",
        "POST /voice/synthesize",
      ]);
      for (const r of routes) {
        expect(r.capabilityScope).toBe("control");
      }
    });

    it("requires the daemon bearer token", async () => {
      const res = await globalThis.fetch(
        `http://127.0.0.1:${port}/voice/transcribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: Buffer.from([1]).toString("base64"),
            mimeType: "audio/wav",
          }),
        },
      );
      expect(res.status).toBe(401);
    });
  });

  describe("POST /voice/transcribe", () => {
    it("returns text and language when an STT provider succeeds", async () => {
      const registry = initProviderRegistry();
      const provider: SpeechToTextProvider = {
        name: "stub-stt",
        async transcribe(input) {
          return {
            text: `heard:${input.mimeType}:${input.audio.length}`,
            language: "en",
          };
        },
      };
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);
      const res = await postJson(port, "/voice/transcribe", {
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "heard:audio/wav:3", language: "en" });
    });

    it("returns 503 with stt-unavailable when no STT provider is registered", async () => {
      initProviderRegistry();
      const res = await postJson(port, "/voice/transcribe", {
        audioBase64: Buffer.from([1]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("stt-unavailable");
    });

    it("returns 400 when required fields are missing", async () => {
      initProviderRegistry();
      const res = await postJson(port, "/voice/transcribe", { foo: "bar" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/required/);
    });

    it("returns 400 when body is empty", async () => {
      initProviderRegistry();
      const res = await postRaw(port, "/voice/transcribe", "");
      expect(res.status).toBe(400);
    });

    it("returns 400 on invalid JSON", async () => {
      initProviderRegistry();
      const res = await postRaw(port, "/voice/transcribe", "{not json");
      expect(res.status).toBe(400);
    });

    it("returns 400 when audioBase64 decodes to empty", async () => {
      initProviderRegistry();
      const res = await postJson(port, "/voice/transcribe", {
        audioBase64: "",
        mimeType: "audio/wav",
      });
      expect(res.status).toBe(400);
    });

    it("returns 502 stt-failed when provider throws a non-unavailable error", async () => {
      const registry = initProviderRegistry();
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, "boom", {
        name: "boom",
        async transcribe() {
          throw new Error("upstream 500");
        },
      } satisfies SpeechToTextProvider);
      const res = await postJson(port, "/voice/transcribe", {
        audioBase64: Buffer.from([1]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("stt-failed");
    });
  });

  describe("POST /voice/synthesize", () => {
    function makeTts(): SpeechSynthesisProvider {
      return {
        name: "stub-tts",
        supportedFormats: ["mp3", "wav"],
        async synthesize(input) {
          return {
            audio: new Uint8Array([10, 20, 30, input.text.length]),
            mimeType: "audio/mpeg",
            format: input.format ?? "mp3",
          };
        },
      };
    }

    it("returns base64 audio when a TTS provider succeeds", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const res = await postJson(port, "/voice/synthesize", {
        text: "round-trip",
        format: "mp3",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { audioBase64: string; mimeType: string; format: string };
      expect(body.mimeType).toBe("audio/mpeg");
      expect(body.format).toBe("mp3");
      const decoded = Buffer.from(body.audioBase64, "base64");
      expect(Array.from(decoded)).toEqual([10, 20, 30, "round-trip".length]);
    });

    it("returns 503 with tts-unavailable when no TTS provider is registered", async () => {
      initProviderRegistry();
      const res = await postJson(port, "/voice/synthesize", { text: "hi" });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("tts-unavailable");
    });

    it("returns 400 tts-format-unsupported when the format is outside the provider's catalog", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const res = await postJson(port, "/voice/synthesize", {
        text: "hi",
        format: "flac",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string; supported?: string[] };
      expect(body.code).toBe("tts-format-unsupported");
      expect(body.supported).toEqual(["mp3", "wav"]);
    });

    it("returns 400 when text is empty", async () => {
      initProviderRegistry();
      const res = await postJson(port, "/voice/synthesize", { text: "  " });
      expect(res.status).toBe(400);
    });

    it("returns 400 when format is not a known enum value", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const res = await postJson(port, "/voice/synthesize", {
        text: "hi",
        format: "weird",
      });
      expect(res.status).toBe(400);
    });
  });
});
