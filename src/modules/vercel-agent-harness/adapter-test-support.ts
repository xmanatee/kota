import { afterEach, beforeEach, expect, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { resolvePreset, resolveTierModel } from "#core/model/preset.js";
import type { ToolEffect } from "#core/tools/effect.js";

type ToolValue =
  | string
  | number
  | boolean
  | null
  | ToolValue[]
  | { [key: string]: ToolValue };

export type ToolInput = { [key: string]: ToolValue };

export type ToolExecuteFn = (
  input: ToolInput,
  ctx: { toolCallId: string },
) => Promise<{ isError: boolean; content: ToolValue }>;

type VercelToolDefinition = {
  execute: ToolExecuteFn;
};

export type StreamTextArgs = {
  model: object;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  tools?: Record<string, VercelToolDefinition>;
  stopWhen: object;
  abortSignal: AbortSignal;
  providerOptions: Record<string, { reasoningEffort?: string }>;
  onChunk: (event: { chunk: { type: string; text?: string } }) => void;
};

export type StreamTextStub = {
  text: Promise<string>;
  totalUsage: Promise<{ inputTokens: number; outputTokens: number }>;
  steps: Promise<Array<{ response: { id: string } }>>;
  finishReason: Promise<string>;
};

type ExecuteToolResult = {
  content: ToolValue;
  isError?: boolean;
};

type ExecuteToolContext = {
  sessionId?: string;
  toolUseId?: string;
  cwd?: string;
  workflow?: AgentHarnessRunOptions["workflowContext"];
  scopeId?: string;
  projectId?: string;
  signal?: AbortSignal;
};

type StepCountMarker = {
  __stepCountIs: number;
};

type JsonSchemaMarker = {
  __jsonSchema: object;
};

type LanguageModel = {
  __languageModel: true;
  modelId: string;
};

type EnqueueApproval = ApprovalQueue["enqueue"];

type CreateOpenAIOptions = {
  apiKey?: string;
};

export let VERCEL_AGENT_HARNESS_NAME = "";
export let vercelAgentHarness: AgentHarness;

export const VERCEL_TEST_MODEL = `openai/${resolveTierModel(
  resolvePreset({ flag: "codex" }).preset,
  "fast",
)}`;

const streamTextMock = vi.hoisted(() =>
  vi.fn<(args: StreamTextArgs) => StreamTextStub>(),
);
const stepCountIsMock = vi.hoisted(() =>
  vi.fn<(n: number) => StepCountMarker>((n) => ({ __stepCountIs: n })),
);
const jsonSchemaMock = vi.hoisted(() =>
  vi.fn<(schema: object) => JsonSchemaMarker>((schema) => ({ __jsonSchema: schema })),
);
const dynamicToolMock = vi.hoisted(() =>
  vi.fn<(definition: VercelToolDefinition) => VercelToolDefinition>(
    (definition) => definition,
  ),
);
const createOpenAIMock = vi.hoisted(() =>
  vi.fn<(_options?: CreateOpenAIOptions) => (modelId: string) => LanguageModel>(),
);
const executeToolMock = vi.hoisted(() =>
  vi.fn<
    (
      name: string,
      input: ToolInput,
      context: ExecuteToolContext,
    ) => Promise<ExecuteToolResult>
  >(),
);
const getAllToolsMock = vi.hoisted(() =>
  vi.fn<() => readonly KotaTool[]>(),
);
const getToolEffectMock = vi.hoisted(() =>
  vi.fn<(name: string, input?: ToolInput) => ToolEffect | undefined>(),
);
const maskKnownSecretValuesMock = vi.hoisted(() =>
  vi.fn<(text: string) => string>(),
);
const confirmActionMock = vi.hoisted(() =>
  vi.fn<(message: string) => Promise<boolean>>(),
);
const enqueueApprovalMock = vi.hoisted(() =>
  vi.fn<EnqueueApproval>(),
);

export const approvalQueueMock = {
  enqueue: (...args: Parameters<EnqueueApproval>) => enqueueApprovalMock(...args),
} as ApprovalQueue;

export {
  confirmActionMock,
  createOpenAIMock,
  dynamicToolMock,
  enqueueApprovalMock,
  executeToolMock,
  getAllToolsMock,
  getToolEffectMock,
  jsonSchemaMock,
  maskKnownSecretValuesMock,
  stepCountIsMock,
  streamTextMock,
};

vi.mock("ai", () => ({
  streamText: (args: StreamTextArgs) => streamTextMock(args),
  stepCountIs: (n: number) => stepCountIsMock(n),
  jsonSchema: (schema: object) => jsonSchemaMock(schema),
  dynamicTool: (definition: VercelToolDefinition) => dynamicToolMock(definition),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (options?: CreateOpenAIOptions) => createOpenAIMock(options),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (
    name: string,
    input: ToolInput,
    context: ExecuteToolContext,
  ) => executeToolMock(name, input, context),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: (name: string, input?: ToolInput) =>
    getToolEffectMock(name, input),
}));

vi.mock("#core/util/confirm.js", () => ({
  confirmAction: (message: string) => confirmActionMock(message),
}));

vi.mock("#core/daemon/approval-queue.js", () => ({
  getApprovalQueue: () => ({
    enqueue: (...args: Parameters<EnqueueApproval>) => enqueueApprovalMock(...args),
  }),
}));

vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (text: string) => maskKnownSecretValuesMock(text),
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

beforeEach(async () => {
  streamTextMock.mockReset();
  stepCountIsMock.mockReset();
  stepCountIsMock.mockImplementation((n: number) => ({ __stepCountIs: n }));
  jsonSchemaMock.mockReset();
  jsonSchemaMock.mockImplementation((schema: object) => ({ __jsonSchema: schema }));
  dynamicToolMock.mockReset();
  dynamicToolMock.mockImplementation((definition) => definition);
  createOpenAIMock.mockReset();
  createOpenAIMock.mockImplementation(() => (modelId: string) => ({
    __languageModel: true,
    modelId,
  }));
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getToolEffectMock.mockReset();
  maskKnownSecretValuesMock.mockReset();
  confirmActionMock.mockReset();
  enqueueApprovalMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  maskKnownSecretValuesMock.mockImplementation((text) => text);
  confirmActionMock.mockResolvedValue(true);
  enqueueApprovalMock.mockReturnValue({
    id: "approval-vercel",
    scopeId: "scope-test",
    tool: "echo_tool",
    input: { text: "queued" },
    risk: "dangerous",
    reason: "test approval",
    createdAt: "2026-07-27T00:00:00.000Z",
    status: "pending",
  });

  const adapter = await import("./adapter.js");
  VERCEL_AGENT_HARNESS_NAME = adapter.VERCEL_AGENT_HARNESS_NAME;
  vercelAgentHarness = adapter.vercelAgentHarness;
});

afterEach(() => {
  vi.clearAllMocks();
});

export function createStreamTextStub(options?: {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  finishReason?: string;
}): StreamTextStub {
  return {
    text: Promise.resolve(options?.text ?? "ok"),
    totalUsage: Promise.resolve({
      inputTokens: options?.inputTokens ?? 1,
      outputTokens: options?.outputTokens ?? 1,
    }),
    steps: Promise.resolve([{ response: { id: options?.sessionId ?? "s1" } }]),
    finishReason: Promise.resolve(options?.finishReason ?? "stop"),
  };
}

export function createRejectedStreamTextStub(message: string): StreamTextStub {
  const error = new Error(message);
  return {
    text: Promise.reject(error),
    totalUsage: Promise.reject(error),
    steps: Promise.reject(error),
    finishReason: Promise.reject(error),
  };
}

export function silenceRejectedStreamTextStub(stub: StreamTextStub): void {
  stub.text.catch(() => {});
  stub.totalUsage.catch(() => {});
  stub.steps.catch(() => {});
  stub.finishReason.catch(() => {});
}

export function captureStreamTextArgs(): StreamTextArgs {
  expect(streamTextMock).toHaveBeenCalled();
  const call = streamTextMock.mock.calls.at(-1);
  if (!call) throw new Error("streamText was not called");
  return call[0];
}
