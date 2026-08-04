import type {
  KotaJsonObject,
  KotaMessage,
  KotaTool,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { McpManager } from "#core/mcp/manager.js";
import { SUB_AGENT_RESULT_LIMIT } from "./delegate-config.js";
import { extractModifiedFiles } from "./delegate-format.js";
import type {
  ToolResultBlock,
  ToolRunner,
  ToolRunnerContext,
} from "./index.js";
import type {
  LocalToolExecutor,
  ToolCallExecutionOptions,
} from "./tool-runner.js";

type DelegateToolInputValue = unknown;

export type DelegateToolResultEntry = {
  tool_use_id: string;
  content: string;
  blocks?: ToolResultBlock[];
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  is_error?: boolean;
};

export async function executeDelegateToolBlocks(args: {
  toolBlocks: readonly KotaToolUseBlock[];
  tools: readonly KotaTool[];
  runners: Record<string, ToolRunner>;
  runnerContext?: ToolRunnerContext;
  toolExecutionOptions?: ToolCallExecutionOptions;
  mcpMgr: McpManager | undefined;
  isExecute: boolean;
  messages: KotaMessage[];
  modifiedFiles: Set<string>;
  urlsFetched: Set<string>;
  searchQueries: Set<string>;
}): Promise<DelegateToolResultEntry[]> {
  const executeLocalTool: LocalToolExecutor = async (name, input, context) => {
    const runner = args.runners[name];
    if (!runner) {
      return { content: `Unknown tool: ${name}`, is_error: true };
    }
    try {
      return await runner(input, context);
    } catch (runnerErr) {
      const errMsg = runnerErr instanceof Error ? runnerErr.message : String(runnerErr);
      return { content: `Tool error (${name}): ${errMsg}`, is_error: true };
    }
  };
  const inherited = args.toolExecutionOptions;
  const context = args.runnerContext;
  const approvalQueue = context?.approvalQueue ?? inherited?.approvalQueue;
  const sessionId = context?.sessionId ?? inherited?.sessionId;
  const cwd = context?.cwd ?? inherited?.cwd;
  const env = context?.env ?? inherited?.env;
  const authorityConfigPath =
    context?.authorityConfigPath ?? inherited?.authorityConfigPath;
  const workflowContext = context?.workflow ?? inherited?.workflowContext;
  const scopeId = context?.scopeId ?? inherited?.scopeId;
  const projectId = context?.projectId ?? inherited?.projectId;
  const tokenBudget = context?.tokenBudget ?? inherited?.tokenBudget;
  const signal = context?.signal ?? inherited?.signal;
  const allowedTools = [
    ...Object.keys(args.runners),
    ...(args.mcpMgr?.getTools().map((tool) => tool.name) ?? []),
  ];
  const inputSchemas = new Map(
    args.tools
      .filter((tool) => Object.hasOwn(args.runners, tool.name))
      .map((tool) => [tool.name, tool.input_schema] as const),
  );
  const executionOptions: ToolCallExecutionOptions = {
    resultLimit: SUB_AGENT_RESULT_LIMIT,
    verbose: inherited?.verbose ?? false,
    autonomyMode: inherited?.autonomyMode ?? "autonomous",
    ...(inherited?.guardrailsConfig !== undefined
      ? { guardrailsConfig: inherited.guardrailsConfig }
      : {}),
    ...(inherited?.scopePolicy !== undefined
      ? { scopePolicy: inherited.scopePolicy }
      : {}),
    ...(inherited?.getScopePolicySnapshot !== undefined
      ? { getScopePolicySnapshot: inherited.getScopePolicySnapshot }
      : {}),
    ...(inherited?.clientApprovalResolver !== undefined
      ? { clientApprovalResolver: inherited.clientApprovalResolver }
      : {}),
    ...(approvalQueue !== undefined ? { approvalQueue } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(authorityConfigPath !== undefined ? { authorityConfigPath } : {}),
    ...(workflowContext !== undefined ? { workflowContext } : {}),
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(inherited?.idempotencyStore !== undefined
      ? { idempotencyStore: inherited.idempotencyStore }
      : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(inherited?.canUseTool !== undefined
      ? { canUseTool: inherited.canUseTool }
      : {}),
    ...(inherited?.mcpInputResolver !== undefined
      ? { mcpInputResolver: inherited.mcpInputResolver }
      : {}),
    ...(inherited?.transport !== undefined ? { transport: inherited.transport } : {}),
    ...(args.mcpMgr !== undefined ? { mcpManager: args.mcpMgr } : {}),
    messages: args.messages,
    allowedTools,
    localToolExecution: { inputSchemas, execute: executeLocalTool },
  };
  const { executeToolCalls } = await import("./tool-runner.js");
  const results = await executeToolCalls([...args.toolBlocks], executionOptions);

  return results.map((result, index): DelegateToolResultEntry => {
    const block = args.toolBlocks[index];
    if (!block) throw new Error(`Delegate tool result ${index} has no matching call`);
    const toolInput = block.input as Record<string, DelegateToolInputValue>;

    if (args.isExecute && !result.is_error) {
      for (const f of extractModifiedFiles(block.name, toolInput, result.content)) {
        args.modifiedFiles.add(f);
      }
    }
    if ((block.name === "web_fetch" || block.name === "http_request") && toolInput.url) {
      args.urlsFetched.add(toolInput.url as string);
    }
    if (block.name === "web_search" && toolInput.query) {
      args.searchQueries.add(toolInput.query as string);
    }

    return {
      tool_use_id: result.tool_use_id,
      content: result.content,
      ...(result.blocks ? { blocks: result.blocks } : {}),
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      ...(result._meta ? { _meta: result._meta } : {}),
      ...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
    };
  });
}
