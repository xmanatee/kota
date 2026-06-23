import type {
  KotaJsonObject,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import { truncateToolResult } from "#core/loop/context.js";
import type { McpManager } from "#core/mcp/manager.js";
import { SUB_AGENT_RESULT_LIMIT } from "./delegate-config.js";
import { extractModifiedFiles } from "./delegate-format.js";
import type {
  ToolResult,
  ToolResultBlock,
  ToolRunner,
  ToolRunnerContext,
} from "./index.js";
import { getToolMiddleware } from "./tool-middleware.js";

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
  runners: Record<string, ToolRunner>;
  runnerContext?: ToolRunnerContext;
  mcpMgr: McpManager | undefined;
  isExecute: boolean;
  modifiedFiles: Set<string>;
  urlsFetched: Set<string>;
  searchQueries: Set<string>;
}): Promise<DelegateToolResultEntry[]> {
  return Promise.all(
    args.toolBlocks.map(async (block): Promise<DelegateToolResultEntry> => {
      const toolInput = block.input as Record<string, DelegateToolInputValue>;
      const isMcp = args.mcpMgr?.isMcpTool(block.name);
      const runner = isMcp ? undefined : args.runners[block.name];
      if (!runner && !isMcp) {
        return {
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        };
      }

      const childRunnerContext = args.runnerContext
        ? { ...args.runnerContext, toolUseId: block.id }
        : undefined;
      const resultContentProvenance = isMcp
        ? args.mcpMgr?.getToolResultContentProvenance?.(block.name)
        : undefined;
      const callContext = childRunnerContext
        ? {
            ...(childRunnerContext.sessionId ? { sessionId: childRunnerContext.sessionId } : {}),
            ...(childRunnerContext.toolUseId ? { toolUseId: childRunnerContext.toolUseId } : {}),
            ...(resultContentProvenance ? { resultContentProvenance } : {}),
            ...(childRunnerContext.signal ? { signal: childRunnerContext.signal } : {}),
          }
        : resultContentProvenance
          ? { resultContentProvenance }
          : undefined;
      const call = { name: block.name, input: toolInput };
      let result: ToolResult;
      try {
        result = await getToolMiddleware().execute(
          callContext ? { ...call, context: callContext } : call,
          () =>
            isMcp
              ? args.mcpMgr!.executeTool(block.name, call.input)
              : runner!(call.input, childRunnerContext),
        );
      } catch (runnerErr) {
        const errMsg = runnerErr instanceof Error ? runnerErr.message : String(runnerErr);
        result = { content: `Tool error (${block.name}): ${errMsg}`, is_error: true };
      }

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
        tool_use_id: block.id,
        content: truncateToolResult(result.content, SUB_AGENT_RESULT_LIMIT),
        ...(result.blocks ? { blocks: result.blocks } : {}),
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result._meta ? { _meta: result._meta } : {}),
        ...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
      };
    }),
  );
}
