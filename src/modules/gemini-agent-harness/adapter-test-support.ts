/**
 * Unit tests for the `gemini` agent harness. The Google Gen AI SDK's
 * `models.generateContentStream` is mocked at the module boundary so the
 * suite asserts on the adapter's loop shape (tool wiring, guardrail
 * enforcement, unsupported-option rejections, reasoning-effort passthrough)
 * without making network calls.
 */

import type { GoogleGenAI } from "@google/genai";
import { afterEach, beforeEach, expect, type Mock, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { maskKnownSecretValues as maskSecrets } from "#core/config/secrets.js";
import type { executeTool as executeKotaTool } from "#core/tools/index.js";

type GenerateContentStream = InstanceType<
  typeof GoogleGenAI
>["models"]["generateContentStream"];

type MockGoogleGenAIInstance = {
  models: {
    generateContentStream: (
      ...args: Parameters<GenerateContentStream>
    ) => ReturnType<GenerateContentStream>;
  };
};

type TestRecordValue =
  | string
  | number
  | boolean
  | null
  | TestRecordValue[]
  | { [key: string]: TestRecordValue | undefined };

type TestRecord = { [key: string]: TestRecordValue | undefined };

export const generateContentStreamMock: Mock = vi.fn();
export const googleGenAICtorMock: Mock = vi.fn();
export const executeToolMock: Mock = vi.fn();
export const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
export const maskKnownSecretValuesMock = vi.fn<(text: string) => string>();

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(
    this: MockGoogleGenAIInstance,
    ...args: ConstructorParameters<typeof GoogleGenAI>
  ) {
    googleGenAICtorMock(...args);
    this.models = {
      generateContentStream: (...callArgs: Parameters<GenerateContentStream>) =>
        generateContentStreamMock(...callArgs),
    };
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: Parameters<typeof executeKotaTool>) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: () => undefined,
}));

vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (...args: Parameters<typeof maskSecrets>) =>
    maskKnownSecretValuesMock(...args),
}));

export const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

type SDKGenerateContentArgs = Parameters<GenerateContentStream>[0];

export type GenerateContentArgs = SDKGenerateContentArgs & {
  config: NonNullable<SDKGenerateContentArgs["config"]>;
};

export function makeStreamFromChunks(
  chunks: ReadonlyArray<TestRecord>,
): AsyncGenerator<TestRecord> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

export function captureLastCallArgs(): GenerateContentArgs {
  expect(generateContentStreamMock).toHaveBeenCalled();
  return generateContentStreamMock.mock.calls[
    generateContentStreamMock.mock.calls.length - 1
  ][0] as GenerateContentArgs;
}

beforeEach(() => {
  generateContentStreamMock.mockReset();
  googleGenAICtorMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  maskKnownSecretValuesMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  maskKnownSecretValuesMock.mockImplementation((text) => text);
});

afterEach(() => {
  vi.clearAllMocks();
});
