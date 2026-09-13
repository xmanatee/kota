import { Buffer } from "node:buffer";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { abortable } from "#core/outbound-http/abortable.js";
import { McpClientConnection } from "./client-connection.js";
import type {
  JsonRpcRequest,
  JsonRpcResult,
  McpCacheHints,
  McpCallToolOptions,
  McpCallToolResult,
  McpCallToolRetry,
  McpCancelTaskResult,
  McpCatalogOptions,
  McpGetPromptResult,
  McpGetTaskResult,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
  McpListToolsPage,
  McpOperationRetry,
  McpReadResourceResult,
  McpToolArguments,
  McpToolInputRequests,
  McpToolInputResponses,
  McpToolSchema,
  McpUpdateTaskResult,
} from "./client-protocol.js";
import {
  CALL_TIMEOUT,
  MCP_CURRENT_PROTOCOL_VERSION,
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
} from "./client-tool-list-decoders.js";

// Whole-operation limits complement the transport's individual response limits.
// Allow large legitimate catalogs without retaining an unbounded peer-controlled graph.
export const MCP_CATALOG_MAX_PAGES = 128;
export const MCP_CATALOG_MAX_ENTRIES = 10_000;
export const MCP_CATALOG_MAX_BYTES = 16 * 1024 * 1024;
export const MCP_CATALOG_TIMEOUT_MS = 30_000;

type CatalogMethod = "tools/list" | "resources/list" | "resources/templates/list" | "prompts/list";
type CatalogPage = { nextCursor?: string; cache: McpCacheHints };

export abstract class McpClientOperations extends McpClientConnection {
  private assertTasksNegotiated(method: "tasks/get" | "tasks/update" | "tasks/cancel"): void {
    if (this.supportsTasks()) return;
    throw this.requestErrorForMethod(
      method,
      `remote MCP Tasks extension was not negotiated; call ${method} only after both client and server advertise task support for the negotiated protocol revision`,
    );
  }

  private decodeCatalogPage<Page>(
    method: CatalogMethod,
    result: JsonRpcResult,
    decode: (result: unknown) => Page,
  ): Page {
    try {
      return decode(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw this.diagnosticError(`MCP ${method} failed for server "${this.serverName}": ${message}`);
    }
  }

  private async listCatalog<Page extends CatalogPage, Entry>(
    method: CatalogMethod,
    decode: (result: unknown) => Page,
    entries: (page: Page) => Entry[],
    options: McpCatalogOptions,
    acceptPage?: (page: Page) => void,
  ): Promise<{ entries: Entry[]; cache: McpCacheHints }> {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const deadline = performance.now() + MCP_CATALOG_TIMEOUT_MS;
    const timeoutError = this.diagnosticError(
      `MCP ${method} catalog traversal for server "${this.serverName}" exceeded ${MCP_CATALOG_TIMEOUT_MS}ms deadline`,
    );
    const timer = setTimeout(() => controller.abort(timeoutError), MCP_CATALOG_TIMEOUT_MS);
    const checkActive = () => {
      // Also check elapsed time between pages: a timely peer can starve timer callbacks.
      if (performance.now() >= deadline) controller.abort(timeoutError);
      signal.throwIfAborted();
    };
    const collected: Entry[] = [];
    const cacheHints: McpCacheHints[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let bytes = 0;
    let pages = 0;
    const limitError = (limit: string) => this.diagnosticError(
      `MCP ${method} catalog traversal for server "${this.serverName}" exceeded ${limit} limit`,
    );
    try {
      do {
        checkActive();
        if (pages >= MCP_CATALOG_MAX_PAGES) throw limitError(`${MCP_CATALOG_MAX_PAGES} pages`);
        const result = await abortable(this.request(
          method,
          cursor !== undefined ? { cursor } : undefined,
          undefined,
          undefined,
          signal,
        ), signal);
        checkActive();
        // Count the full result, including cursors, rejected entries and metadata,
        // before decoding or retaining this page. This is serialized size, not heap usage.
        bytes += Buffer.byteLength(JSON.stringify(result) ?? "null", "utf8");
        if (bytes > MCP_CATALOG_MAX_BYTES) throw limitError(`${MCP_CATALOG_MAX_BYTES} aggregate bytes`);
        const page = this.decodeCatalogPage(method, result, decode);
        const pageEntries = entries(page);
        if (collected.length + pageEntries.length > MCP_CATALOG_MAX_ENTRIES) {
          throw limitError(`${MCP_CATALOG_MAX_ENTRIES} entries`);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined && seenCursors.has(cursor)) {
          throw this.diagnosticError(
            `Malformed MCP ${method} result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        checkActive();
        if (cursor !== undefined) seenCursors.add(cursor);
        collected.push(...pageEntries);
        cacheHints.push(page.cache);
        acceptPage?.(page);
        pages++;
      } while (cursor !== undefined);
      checkActive();
      return { entries: collected, cache: combineListCacheHints(cacheHints) };
    } finally {
      clearTimeout(timer);
    }
  }

  private reportRejectedTools(page: McpListToolsPage): void {
    for (const rejected of page.rejectedTools) {
      const toolLabel = rejected.toolName ? `tool "${rejected.toolName}"` : "tool definition";
      this.writeDiagnostic(
        `[kota] Warning: rejected MCP ${toolLabel} from server "${this.serverName}": ${rejected.reason}`,
        "warn",
      );
    }
  }

  async listToolsPage(cursor?: string): Promise<McpListToolsPage> {
    const result = await this.request("tools/list", cursor !== undefined ? { cursor } : undefined);
    const page = this.decodeCatalogPage("tools/list", result, (value) => decodeListToolsResult(value, this.protocolVersion ?? undefined));
    this.reportRejectedTools(page);
    this.cacheHeaderParameters(page.tools);
    return page;
  }

  /** List the complete catalog; failure never publishes partial header parameters. */
  async listTools(options: McpCatalogOptions = {}): Promise<McpToolSchema[]> {
    const catalog = await this.listCatalog(
      "tools/list", (value) => decodeListToolsResult(value, this.protocolVersion ?? undefined), (page) => page.tools, options,
      (page) => this.reportRejectedTools(page),
    );
    this.cacheHeaderParameters(catalog.entries);
    return catalog.entries;
  }

  async listResourcesPage(cursor?: string): Promise<McpListResourcesPage> {
    const result = await this.request("resources/list", cursor !== undefined ? { cursor } : undefined);
    return this.decodeCatalogPage("resources/list", result, decodeListResourcesResult);
  }

  /** List available resources from the server across all pages. */
  async listResources(options: McpCatalogOptions = {}): Promise<McpListResourcesPage> {
    const catalog = await this.listCatalog(
      "resources/list", decodeListResourcesResult, (page) => page.resources, options,
    );
    return { resources: catalog.entries, cache: catalog.cache };
  }

  async listResourceTemplatesPage(cursor?: string): Promise<McpListResourceTemplatesPage> {
    const result = await this.request("resources/templates/list", cursor !== undefined ? { cursor } : undefined);
    return this.decodeCatalogPage("resources/templates/list", result, decodeListResourceTemplatesResult);
  }

  /** List available resource templates from the server across all pages. */
  async listResourceTemplates(options: McpCatalogOptions = {}): Promise<McpListResourceTemplatesPage> {
    const catalog = await this.listCatalog(
      "resources/templates/list", decodeListResourceTemplatesResult, (page) => page.resourceTemplates, options,
    );
    return { resourceTemplates: catalog.entries, cache: catalog.cache };
  }

  async listPromptsPage(cursor?: string): Promise<McpListPromptsPage> {
    const result = await this.request("prompts/list", cursor !== undefined ? { cursor } : undefined);
    return this.decodeCatalogPage("prompts/list", result, decodeListPromptsResult);
  }

  /** List available prompts from the server across all pages. */
  async listPrompts(options: McpCatalogOptions = {}): Promise<McpListPromptsPage> {
    const catalog = await this.listCatalog(
      "prompts/list", decodeListPromptsResult, (page) => page.prompts, options,
    );
    return { prompts: catalog.entries, cache: catalog.cache };
  }

  /** Read a resource from the server. */
  async readResource(
    uri: string,
    retry?: McpOperationRetry,
  ): Promise<McpReadResourceResult> {
    const params: JsonRpcRequest["params"] = { uri };
    this.applyInputRetryParams(params, retry, "resources/read");
    const result = await this.request("resources/read", params, CALL_TIMEOUT);
    const decoded = this.decodeWithRedaction(() => decodeReadResourceResult(
      result,
      this.protocolVersion ?? MCP_CURRENT_PROTOCOL_VERSION,
    ));
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
  }

  async listRemoteSkills(): Promise<McpRemoteSkillCatalog> {
    let result: McpReadResourceResult;
    try {
      result = await this.readResource(MCP_SKILL_INDEX_RESOURCE_URI);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return unavailableRemoteSkillCatalog(this.redactSensitiveErrorMessage(message), this.supportsSkills());
    }
    if (result.resultType === "input_required") {
      throw this.diagnosticError(
        `MCP remote skill index on server "${this.serverName}" requires additional input`,
      );
    }
    return this.decodeWithRedaction(() => decodeRemoteSkillIndexResource(result, this.serverName, this.supportsSkills()));
  }

  async readRemoteSkill(
    uri: string,
    source: McpRemoteSkillSource = "direct",
    retry?: McpOperationRetry,
  ): Promise<McpRemoteSkillReadResult> {
    this.decodeWithRedaction(() => assertValidRemoteSkillResourceUri(uri));
    const result = await this.readResource(uri, retry);
    return this.decodeWithRedaction(() => toRemoteSkillReadResult(result, this.serverName, uri, source));
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
    const decoded = this.decodeWithRedaction(() => decodeGetPromptResult(
      result,
      this.protocolVersion ?? MCP_CURRENT_PROTOCOL_VERSION,
    ));
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
    const decoded = this.decodeWithRedaction(() => decodeCallToolResult(
      result,
      this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION,
    ));
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
    return this.decodeWithRedaction(() => decodeGetTaskResult(
      result,
      this.protocolVersion ?? MCP_CURRENT_PROTOCOL_VERSION,
    ));
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
    params.inputResponses = this.decodeWithRedaction(() => decodeMcpToolInputResponses(
      update.inputResponses,
      update.inputRequests,
      "tasks/update",
    ));
    try {
      const result = await this.request("tasks/update", params, CALL_TIMEOUT);
      return this.decodeWithRedaction(() => decodeEmptyTaskAckResult(result, "tasks/update"));
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
    return this.decodeWithRedaction(() => decodeEmptyTaskAckResult(result, "tasks/cancel"));
  }

}

function combineListCacheHints(hints: readonly McpCacheHints[]): McpCacheHints {
  return {
    ttlMs: hints.length === 0 ? 0 : Math.min(...hints.map((hint) => hint.ttlMs)),
    cacheScope: hints.every((hint) => hint.cacheScope === "public") ? "public" : "private",
  };
}
