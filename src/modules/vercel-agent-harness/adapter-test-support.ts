import { afterEach, beforeEach, expect, vi } from "vitest";
import type {
  AgentCanUseTool,
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { resolvePreset, resolveTierModel } from "#core/model/preset.js";

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
  toolUseId?: string;
  cwd?: string;
  workflow?: AgentHarnessRunOptions["workflowContext"];
  scopeId?: string;
  projectId?: string;
  signal?: AbortSignal;
};

type SecretMasker = {
  mask(text: string): string;
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

type CreateOpenAIOptions = {
  apiKey?: string;
};

export let VERCEL_AGENT_HARNESS_NAME = "";
export let vercelAgentHarness: AgentHarness;

const VERCEL_TEST_MODEL = `openai/${resolveTierModel(
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
const getSecretStoreMock = vi.hoisted(() =>
  vi.fn<() => SecretMasker | null>(),
);

export {
  createOpenAIMock,
  dynamicToolMock,
  executeToolMock,
  getAllToolsMock,
  getSecretStoreMock,
  jsonSchemaMock,
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
}));

vi.mock("#core/config/secrets.js", () => ({
  getSecretStore: () => getSecretStoreMock(),
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
  getSecretStoreMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  getSecretStoreMock.mockReturnValue(null);

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

export async function runAndCaptureToolExecute(opts: {
  harness: Pick<AgentHarness, "run">;
  canUseTool?: AgentCanUseTool;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  workflowContext?: AgentHarnessRunOptions["workflowContext"];
}): Promise<{
  toolExecute: ToolExecuteFn;
  streamArgs: StreamTextArgs;
}> {
  streamTextMock.mockImplementation(() => createStreamTextStub());

  await opts.harness.run({
    prompt: "go",
    model: VERCEL_TEST_MODEL,
    effort: "xhigh",
    ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
    ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
    ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.workflowContext ? { workflowContext: opts.workflowContext } : {}),
  });

  const streamArgs = captureStreamTextArgs();
  const toolExecute = streamArgs.tools?.echo_tool?.execute;
  if (!toolExecute) throw new Error("echo_tool execute was not registered");
  return { toolExecute, streamArgs };
}
