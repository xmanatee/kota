import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";

const messagesCreateMock = vi.fn();
const messagesStreamMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#modules/claude-agent-harness/executor.js", async (importActual) => {
  const actual = await importActual<
    typeof import("#modules/claude-agent-harness/executor.js")
  >();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) => executeWithAgentSDKMock(...args),
  };
});

// The openai-tools adapter calls `getAllTools()` to filter the catalog before
// streaming. We do not exercise tool execution here — the mocked stream hangs
// forever — but the call still needs to resolve to a tool list, so we stub the
// registry with an empty catalog rather than depend on the real tool registry's
// initialization order in this isolated test.
vi.mock("#core/tools/index.js", () => ({
  executeTool: vi.fn(),
  getAllTools: () => [],
}));

import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";

beforeEach(() => {
  messagesCreateMock.mockReset();
  messagesStreamMock.mockReset();
  createModelClientMock.mockReset();
  executeWithAgentSDKMock.mockReset();

  createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
    client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
    model,
    providerName: "stub",
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Cross-harness parity guard for the agent-harness abort-propagation contract
 * declared in `src/core/agent-harness/AGENTS.md`. Every registered adapter
 * must honor `AgentHarnessRunOptions.abortController`:
 *
 * - **Pre-run**: when the caller passes an already-aborted controller, the
 *   adapter rejects with the signal's reason without producing a model call.
 * - **Mid-run**: when the caller aborts the controller after the model call
 *   has begun, the adapter rejects with the signal's reason rather than
 *   waiting for the model to return on its own.
 *
 * Operator cancellation through the daemon control API and daemon-shutdown
 * teardown both rely on this contract end-to-end. A regression in any one
 * adapter (for example the thin adapter's pre-fix gap that checked
 * `signal.aborted` only before the model call but never threaded the signal
 * into `messages.create`) would silently leave operator aborts hanging on
 * that harness.
 *
 * Each adapter declares its abort surface below: the mock entry point the
 * adapter calls when it propagates the signal. The assertions are identical
 * across adapters so a regression in one harness fails one adapter's block
 * while the others stay green.
 */

type AbortSurfaceCheck = {
  /** Assert the adapter's downstream call observed the signal. */
  signalReceived(): AbortSignal | undefined;
};

type AdapterCase = {
  name: string;
  harness: AgentHarness;
  baseOptions: () => AgentHarnessRunOptions;
  /** Wire the abort-aware mock for this adapter. Returns the verifier. */
  installAbortAwareMock(): AbortSurfaceCheck;
};

function makeAbortAwareCreate(
  mock: typeof messagesCreateMock,
): AbortSurfaceCheck {
  let observed: AbortSignal | undefined;
  mock.mockImplementation((params: { signal?: AbortSignal }) => {
    observed = params.signal;
    return new Promise((_resolve, reject) => {
      const signal = params.signal;
      if (!signal) return; // never resolves — surfaces a missing-signal regression
      if (signal.aborted) {
        reject(toError(signal.reason));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(toError(signal.reason)),
        { once: true },
      );
    });
  });
  return { signalReceived: () => observed };
}

function makeAbortAwareStream(
  mock: typeof messagesStreamMock,
): AbortSurfaceCheck {
  let observed: AbortSignal | undefined;
  mock.mockImplementation((params: { signal?: AbortSignal }) => {
    observed = params.signal;
    const signal = params.signal;
    return {
      on(_event: "text" | "thinking", _cb: (delta: string) => void) {
        return this;
      },
      finalMessage: () =>
        new Promise((_resolve, reject) => {
          if (!signal) return; // never resolves — surfaces a missing-signal regression
          if (signal.aborted) {
            reject(toError(signal.reason));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(toError(signal.reason)),
            { once: true },
          );
        }),
    };
  });
  return { signalReceived: () => observed };
}

function makeAbortAwareExecutor(
  mock: typeof executeWithAgentSDKMock,
): AbortSurfaceCheck {
  let observed: AbortSignal | undefined;
  mock.mockImplementation(
    async (_prompt: string, options: { abortController?: AbortController }) => {
      const signal = options.abortController?.signal;
      observed = signal;
      if (!signal) return { text: "", streamedText: "", turns: 0, isError: false };
      if (signal.aborted) throw toError(signal.reason);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(toError(signal.reason)), {
          once: true,
        });
      });
      return { text: "", streamedText: "", turns: 0, isError: false };
    },
  );
  return { signalReceived: () => observed };
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Agent execution aborted");
}

const ADAPTERS: AdapterCase[] = [
  {
    name: "thin",
    harness: thinAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "be terse",
    }),
    installAbortAwareMock: () => makeAbortAwareCreate(messagesCreateMock),
  },
  {
    name: "openai-tools",
    harness: openaiToolsAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
    }),
    installAbortAwareMock: () => makeAbortAwareStream(messagesStreamMock),
  },
  {
    name: "claude-agent-sdk",
    harness: claudeAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
    }),
    installAbortAwareMock: () => makeAbortAwareExecutor(executeWithAgentSDKMock),
  },
];

describe.each(ADAPTERS)(
  "abort parity: $name harness honors AgentHarnessRunOptions.abortController",
  (adapter) => {
    it("pre-run — rejects with the abort reason when the controller is aborted before run()", async () => {
      const surface = adapter.installAbortAwareMock();
      const controller = new AbortController();
      const reason = new Error("pre-run-aborted");
      controller.abort(reason);

      await expect(
        adapter.harness.run({ ...adapter.baseOptions(), abortController: controller }),
      ).rejects.toThrow(/pre-run-aborted/);

      // The adapter must propagate the signal to its underlying surface (or
      // short-circuit before reaching it). If it reached the surface, the
      // signal must be the caller's, not a fresh one. The thin and openai-
      // tools adapters short-circuit at their boundary and never call the
      // mock; the claude-agent-sdk adapter forwards the abortController to
      // executeWithAgentSDK, where the executor's own pre-run check throws.
      const observed = surface.signalReceived();
      if (observed !== undefined) {
        expect(observed).toBe(controller.signal);
        expect(observed.aborted).toBe(true);
      }
    });

    it("mid-run — rejects with the abort reason when the controller is aborted during the in-flight model call", async () => {
      const surface = adapter.installAbortAwareMock();
      const controller = new AbortController();
      const reason = new Error("mid-run-aborted");

      const promise = adapter.harness.run({
        ...adapter.baseOptions(),
        abortController: controller,
      });
      // Let the adapter reach its model call and register the abort listener
      // on the caller's signal before we abort. A handful of microtasks is
      // enough; we do not depend on real timers.
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      controller.abort(reason);

      await expect(promise).rejects.toThrow(/mid-run-aborted/);

      const observed = surface.signalReceived();
      expect(observed).toBeDefined();
      expect(observed).toBe(controller.signal);
      expect(observed?.aborted).toBe(true);
    });
  },
);
