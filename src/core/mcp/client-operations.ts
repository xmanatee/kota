import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { McpClientConnection } from "./client-connection.js";
import type {
  JsonRpcRequest,
  McpCallToolOptions,
  McpCallToolResult,
  McpCallToolRetry,
  McpCancelTaskResult,
  McpGetPromptResult,
  McpGetTaskResult,
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
  McpToolInputRequests,
  McpToolInputResponses,
  McpToolSchema,
  McpUpdateTaskResult,
} from "./client-protocol.js";
import {
  CALL_TIMEOUT,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
} from "./client-protocol.js";
import {
  assertValidRemoteSkillResourceUri,
  decodeRemoteSkillIndexResource,
  MCP_SKILL_INDEX_RESOURCE_URI,
  type McpRemoteSkillCatalog,
  type McpRemoteSkillReadResult,
  type McpRemoteSkillSource,
  toRemoteSkillReadResult,
  unavailableRemoteSkillCatalog,
} from "./client-remote-skills.js";
import {
  decodeListPromptsResult,
  decodeListResourcesResult,
  decodeListResourceTemplatesResult,
} from "./client-resource-prompt-list-decoders.js";
import {
  decodeCallToolResult,
  decodeEmptyTaskAckResult,
  decodeGetPromptResult,
  decodeGetTaskResult,
  decodeMcpToolInputResponses,
  decodeReadResourceResult,
} from "./client-result-decoders.js";
import {
  decodeListToolsResult,
  warnRejectedTool,
} from "./client-tool-list-decoders.js";

export abstract class McpClientOperations extends McpClientConnection {
  private assertTasksNegotiated(method: "tasks/get" | "tasks/update" | "tasks/cancel"): void {
    if (this.supportsTasks()) return;
    throw this.requestErrorForMethod(
      method,
      `remote MCP Tasks extension was not negotiated; enable ${MCP_DRAFT_PROTOCOL_VERSION} ${method} only after both client and server advertise task support`,
    );
  }

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

  async listRemoteSkills(): Promise<McpRemoteSkillCatalog> {
    let result: McpReadResourceResult;
    try {
      result = await this.readResource(MCP_SKILL_INDEX_RESOURCE_URI);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return unavailableRemoteSkillCatalog(message, this.supportsSkills());
    }
    if (result.resultType === "input_required") {
      throw new Error(
        `MCP remote skill index on server "${this.serverName}" requires additional input`,
      );
    }
    return decodeRemoteSkillIndexResource(
      result,
      this.serverName,
      this.supportsSkills(),
    );
  }

  async readRemoteSkill(
    uri: string,
    source: McpRemoteSkillSource = "direct",
    retry?: McpOperationRetry,
  ): Promise<McpRemoteSkillReadResult> {
    assertValidRemoteSkillResourceUri(uri);
    const result = await this.readResource(uri, retry);
    return toRemoteSkillReadResult(result, this.serverName, uri, source);
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
    if (decoded.resultType === "task" && !this.supportsTasks()) {
      throw this.requestErrorForMethod(
        "tools/call",
        'server returned resultType "task" without negotiated io.modelcontextprotocol/tasks support',
      );
    }
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
  }

  async getTask(taskId: string): Promise<McpGetTaskResult> {
    this.assertTasksNegotiated("tasks/get");
    const result = await this.request("tasks/get", { taskId }, CALL_TIMEOUT);
    return decodeGetTaskResult(result);
  }

  async updateTask(
    taskId: string,
    update: {
      inputResponses: McpToolInputResponses;
      inputRequests?: McpToolInputRequests;
      requestState?: string;
    },
  ): Promise<McpUpdateTaskResult> {
    this.assertTasksNegotiated("tasks/update");
    const params: JsonRpcRequest["params"] = { taskId };
    if (update.requestState !== undefined) {
      if (update.requestState.length === 0) {
        throw new Error("Malformed MCP tasks/update request: requestState must be a non-empty string");
      }
      params.requestState = update.requestState;
    }
    params.inputResponses = decodeMcpToolInputResponses(
      update.inputResponses,
      update.inputRequests,
      "tasks/update",
    );
    try {
      const result = await this.request("tasks/update", params, CALL_TIMEOUT);
      return decodeEmptyTaskAckResult(result, "tasks/update");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Malformed MCP tasks/update request") ||
        message.includes("Malformed MCP tasks/update result")
      ) {
        throw err;
      }
      throw this.requestErrorForMethod(
        "tasks/update",
        "remote task input update failed",
      );
    }
  }

  async cancelTask(taskId: string): Promise<McpCancelTaskResult> {
    this.assertTasksNegotiated("tasks/cancel");
    const result = await this.request("tasks/cancel", { taskId }, CALL_TIMEOUT);
    return decodeEmptyTaskAckResult(result, "tasks/cancel");
  }

}
