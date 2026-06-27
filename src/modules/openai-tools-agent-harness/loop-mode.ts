import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  KotaTool,
} from "#core/agent-harness/index.js";
import type { ToolResultEntry } from "#core/tools/tool-runner.js";
import { executeOpenaiToolCalls } from "./adapter-runtime.js";
import { DEFAULT_MAX_TURNS } from "./constants.js";
import { selectToolDefinitions, type ValidatedToolUseBlock } from "./tool-loop.js";

export type OpenaiToolsLoopMode = {
  systemPrompt: (base: string | undefined) => string | undefined;
  defaultMaxTurns: number;
  selectTools: (
    allowed: readonly string[] | undefined,
    disallowed: readonly string[] | undefined,
    includeAskOwner: boolean,
    mcpTools: readonly KotaTool[],
  ) => KotaTool[];
  executeTools: (
    toolBlocks: ValidatedToolUseBlock[],
    options: AgentHarnessRunOptions,
    context: Parameters<typeof executeOpenaiToolCalls>[2],
  ) => Promise<ToolResultEntry[]>;
  parseJsonAction?: (text: string, id: string) => ValidatedToolUseBlock | null;
  finalizeResponse?: (result: AgentHarnessResult) => AgentHarnessResult;
};

export const defaultLoopMode: OpenaiToolsLoopMode = {
  systemPrompt: (base) => base,
  defaultMaxTurns: DEFAULT_MAX_TURNS,
  selectTools: selectToolDefinitions,
  executeTools: executeOpenaiToolCalls,
};
