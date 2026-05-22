import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { McpClientConnection } from "./client-connection.js";
import type {
  JsonRpcRequest,
  McpCallToolOptions,
  McpCallToolResult,
  McpCallToolRetry,
  McpGetPromptResult,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
  McpListToolsPage,
  McpOperationRetry,
  McpPromptSchema,
  McpReadResourceResult,
  McpResourceSchema,
  McpResourceTemplateSchema,
  McpToolArguments,
  McpToolSchema,
} from "./client-protocol.js";
import {
  CALL_TIMEOUT,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
} from "./client-protocol.js";
import {
  decodeListPromptsResult,
  decodeListResourcesResult,
  decodeListResourceTemplatesResult,
} from "./client-resource-prompt-list-decoders.js";
import {
  decodeCallToolResult,
  decodeGetPromptResult,
  decodeReadResourceResult,
} from "./client-result-decoders.js";
import {
  decodeListToolsResult,
  warnRejectedTool,
} from "./client-tool-list-decoders.js";

export abstract class McpClientOperations extends McpClientConnection {
  async listToolsPage(cursor?: string): Promise<McpListToolsPage> {
    const result = await this.request(
      "tools/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    let page: McpListToolsPage;
    try {
      page = decodeListToolsResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP tools/list failed for server "${this.serverName}": ${message}`,
      );
    }
    for (const rejected of page.rejectedTools) {
      warnRejectedTool(this.serverName, rejected);
    }
    this.cacheHeaderParameters(page.tools);
    return page;
  }

  /** List available tools from the server. */
  async listTools(): Promise<McpToolSchema[]> {
    const tools: McpToolSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listToolsPage(cursor);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP tools/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    this.cacheHeaderParameters(tools);
    return tools;
  }

  async listResourcesPage(cursor?: string): Promise<McpListResourcesPage> {
    const result = await this.request(
      "resources/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListResourcesResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP resources/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available resources from the server across all pages. */
  async listResources(): Promise<McpResourceSchema[]> {
    const resources: McpResourceSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listResourcesPage(cursor);
      resources.push(...page.resources);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP resources/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return resources;
  }

  async listResourceTemplatesPage(cursor?: string): Promise<McpListResourceTemplatesPage> {
    const result = await this.request(
      "resources/templates/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListResourceTemplatesResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP resources/templates/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available resource templates from the server across all pages. */
  async listResourceTemplates(): Promise<McpResourceTemplateSchema[]> {
    const resourceTemplates: McpResourceTemplateSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listResourceTemplatesPage(cursor);
      resourceTemplates.push(...page.resourceTemplates);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP resources/templates/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return resourceTemplates;
  }

  async listPromptsPage(cursor?: string): Promise<McpListPromptsPage> {
    const result = await this.request(
      "prompts/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListPromptsResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP prompts/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available prompts from the server across all pages. */
  async listPrompts(): Promise<McpPromptSchema[]> {
    const prompts: McpPromptSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listPromptsPage(cursor);
      prompts.push(...page.prompts);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP prompts/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return prompts;
  }

  /** Read a resource from the server. */
  async readResource(
    uri: string,
    retry?: McpOperationRetry,
  ): Promise<McpReadResourceResult> {
    const params: JsonRpcRequest["params"] = { uri };
    this.applyInputRetryParams(params, retry, "resources/read");
    const result = await this.request("resources/read", params, CALL_TIMEOUT);
    const decoded = decodeReadResourceResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
  }

  /** Get a prompt from the server. */
  async getPrompt(
    name: string,
    args: KotaJsonObject = {},
    retry?: McpOperationRetry,
  ): Promise<McpGetPromptResult> {
    const params: JsonRpcRequest["params"] = { name, arguments: args };
    this.applyInputRetryParams(params, retry, "prompts/get");
    const result = await this.request("prompts/get", params, CALL_TIMEOUT);
    const decoded = decodeGetPromptResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: McpToolArguments,
    retry?: McpCallToolRetry,
    options: McpCallToolOptions = {},
  ): Promise<McpCallToolResult> {
    const params: JsonRpcRequest["params"] = { name, arguments: args };
    this.applyInputRetryParams(params, retry, "tools/call");
    const result = await this.request("tools/call", params, CALL_TIMEOUT, options.progress);
    const decoded = decodeCallToolResult(
      result,
      this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
  }

}
