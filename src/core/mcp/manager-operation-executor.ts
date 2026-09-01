import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import type {
  McpGetPromptResult,
  McpInputRequiredResult,
  McpReadResourceResult,
} from "./client.js";
import { McpToolError } from "./client.js";
import {
  assertValidRemoteSkillResourceUri,
  type McpRemoteSkillCatalogEntry,
  type McpRemoteSkillReadResult,
  type McpRemoteSkillSource,
  resolveRemoteSkillRelativeUri,
} from "./client-remote-skills.js";
import type { McpManagerClient } from "./manager-client-port.js";
import { isJsonObject } from "./manager-config-utils.js";
import type { McpExecuteToolOptions } from "./manager-execution-types.js";
import type { McpOperationCache } from "./manager-operation-cache.js";
import type { McpOperationEntry } from "./manager-tool-registry.js";

type McpRemoteSkillReadTarget = {
  uri: string;
  source: McpRemoteSkillSource;
};

export class McpOperationExecutor {
  constructor(private readonly cache: McpOperationCache) {}

  async execute(
    entry: McpOperationEntry,
    input: KotaJsonObject,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    if (!entry.client.isConnected()) {
      return { content: `MCP server disconnected for operation: ${entry.tool.name}`, is_error: true };
    }
    try {
      if (entry.kind === "resources/list") {
        const result = await this.cache.listCatalog(
          entry,
          "resources/list",
          () => entry.client.listResources(),
        );
        return operationResult({ resources: result.catalog.resources }, result.meta);
      }
      if (entry.kind === "resources/templates/list") {
        const result = await this.cache.listCatalog(
          entry,
          "resources/templates/list",
          () => entry.client.listResourceTemplates(),
        );
        return operationResult(
          { resourceTemplates: result.catalog.resourceTemplates },
          result.meta,
        );
      }
      if (entry.kind === "resources/read") {
        const uri = stringInput(input, "uri", entry.tool.name);
        if (!uri.ok) return uri.result;
        return this.finishInvocation(
          entry,
          await entry.client.readResource(uri.value),
          input,
          options,
        );
      }
      if (entry.kind === "skills/list") {
        const result = await this.cache.remoteSkillCatalog(entry);
        return operationResult({
          server: entry.serverName,
          displayName: entry.client.getName(),
          ...result.catalog,
        }, result.meta);
      }
      if (entry.kind === "skills/read") {
        const target = await this.remoteSkillReadTarget(entry, input);
        if (!target.ok) return target.result;
        const result = await entry.client.readRemoteSkill(target.value.uri, target.value.source);
        return this.finishSkillRead(entry, result, options, target.value);
      }
      if (entry.kind === "prompts/list") {
        const result = await this.cache.listCatalog(
          entry,
          "prompts/list",
          () => entry.client.listPrompts(),
        );
        return operationResult({ prompts: result.catalog.prompts }, result.meta);
      }
      const name = stringInput(input, "name", entry.tool.name);
      if (!name.ok) return name.result;
      const args = promptArgumentsInput(input);
      if (!args.ok) return args.result;
      return this.finishInvocation(
        entry,
        await entry.client.getPrompt(name.value, args.value),
        input,
        options,
      );
    } catch (error) {
      if (!entry.client.isConnected()) {
        return { content: `MCP server disconnected for operation: ${entry.tool.name}`, is_error: true };
      }
      const message = error instanceof McpToolError
        ? error.message
        : `MCP operation error: ${error instanceof Error ? error.message : String(error)}`;
      return { content: message, is_error: true };
    }
  }

  private async remoteSkillReadTarget(
    entry: McpOperationEntry,
    input: KotaJsonObject,
  ): Promise<{ ok: true; value: McpRemoteSkillReadTarget } | { ok: false; result: ToolResult }> {
    const name = input.name;
    const uri = input.uri;
    const hasName = typeof name === "string" && name.length > 0;
    const hasUri = typeof uri === "string" && uri.length > 0;
    if (hasName === hasUri) {
      return inputError(
        `${entry.tool.name} requires exactly one non-empty string input "name" or "uri"`,
      );
    }
    const relativePath = input.relativePath;
    if (relativePath !== undefined && (typeof relativePath !== "string" || relativePath.length === 0)) {
      return inputError(`${entry.tool.name} input "relativePath" must be a non-empty string when provided`);
    }
    try {
      if (hasUri && typeof uri === "string") {
        const readUri = relativePath === undefined
          ? uri
          : resolveRemoteSkillRelativeUri(uri, relativePath as string);
        assertValidRemoteSkillResourceUri(readUri);
        return { ok: true, value: { uri: readUri, source: "direct" } };
      }
      const catalog = await this.cache.remoteSkillCatalog(entry);
      if (catalog.catalog.status !== "enumerated") {
        return inputError(
          `remote skill catalog for server "${entry.serverName}" is unavailable; ` +
            `read by skill:// URI instead. Reason: ${catalog.catalog.reason}`,
        );
      }
      const matches = catalog.catalog.skills.filter(
        (skill): skill is Extract<McpRemoteSkillCatalogEntry, { type: "skill-md" }> =>
          skill.type === "skill-md" && skill.name === name,
      );
      if (matches.length === 0) {
        return inputError(`remote skill "${String(name)}" was not found on server "${entry.serverName}"`);
      }
      const readUri = relativePath === undefined
        ? matches[0].uri
        : resolveRemoteSkillRelativeUri(matches[0].uri, relativePath as string);
      return { ok: true, value: { uri: readUri, source: "enumerated" } };
    } catch (error) {
      return inputError(error instanceof Error ? error.message : String(error));
    }
  }

  private async finishSkillRead(
    entry: McpOperationEntry,
    result: McpRemoteSkillReadResult,
    options: McpExecuteToolOptions,
    target: McpRemoteSkillReadTarget,
  ): Promise<ToolResult> {
    if (result.resultType !== "input_required") return operationResult(result);
    if (!result.inputRequests) {
      if (result.requestState === undefined) {
        return unsupportedInput(entry, result, "the remote server returned input_required without inputRequests or requestState.");
      }
      const retried = await entry.client.readRemoteSkill(target.uri, target.source, {
        requestState: result.requestState,
      });
      return retried.resultType === "input_required"
        ? unsupportedInput(entry, retried, "the remote server requested additional input again after the retry.")
        : operationResult(retried);
    }
    if (!options.inputResolver) return unsupportedInput(entry, result);
    const routed = await options.inputResolver(remoteInputRequest(entry, result));
    if (routed.kind === "unavailable") return unsupportedInput(entry, result, routed.reason);
    const retried = await entry.client.readRemoteSkill(target.uri, target.source, {
      inputResponses: routed.inputResponses,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    });
    return retried.resultType === "input_required"
      ? unsupportedInput(entry, retried, "the remote server requested additional input again after the retry.")
      : operationResult(retried);
  }

  private async finishInvocation(
    entry: McpOperationEntry,
    result: McpReadResourceResult | McpGetPromptResult,
    input: KotaJsonObject,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    if (result.resultType !== "input_required") return operationResult(result);
    if (!result.inputRequests) {
      if (result.requestState === undefined) {
        return unsupportedInput(entry, result, "the remote server returned input_required without inputRequests or requestState.");
      }
      const retried = await this.retry(entry, input, { requestState: result.requestState });
      return retried.resultType === "input_required"
        ? unsupportedInput(entry, retried, "the remote server requested additional input again after the retry.")
        : operationResult(retried);
    }
    if (!options.inputResolver) return unsupportedInput(entry, result);
    const routed = await options.inputResolver(remoteInputRequest(entry, result));
    if (routed.kind === "unavailable") return unsupportedInput(entry, result, routed.reason);
    const retried = await this.retry(entry, input, {
      inputResponses: routed.inputResponses,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    });
    return retried.resultType === "input_required"
      ? unsupportedInput(entry, retried, "the remote server requested additional input again after the retry.")
      : operationResult(retried);
  }

  private async retry(
    entry: McpOperationEntry,
    input: KotaJsonObject,
    retry: Parameters<McpManagerClient["readResource"]>[1],
  ): Promise<McpReadResourceResult | McpGetPromptResult> {
    if (entry.kind === "resources/read") {
      const uri = stringInput(input, "uri", entry.tool.name);
      if (!uri.ok) throw new Error(uri.result.content);
      return entry.client.readResource(uri.value, retry);
    }
    if (entry.kind === "prompts/get") {
      const name = stringInput(input, "name", entry.tool.name);
      if (!name.ok) throw new Error(name.result.content);
      const args = promptArgumentsInput(input);
      if (!args.ok) throw new Error(args.result.content);
      return entry.client.getPrompt(name.value, args.value, retry);
    }
    throw new Error(`MCP operation ${entry.kind} does not support input retry`);
  }
}

function operationResult(value: object, meta?: KotaJsonObject): ToolResult {
  const structuredContent = JSON.parse(JSON.stringify(value)) as KotaJsonObject;
  return {
    content: JSON.stringify(structuredContent, null, 2),
    structuredContent,
    ...(meta ? { _meta: meta } : {}),
  };
}

function stringInput(
  input: KotaJsonObject,
  key: string,
  operationName: string,
): { ok: true; value: string } | { ok: false; result: ToolResult } {
  const value = input[key];
  return typeof value === "string" && value.length > 0
    ? { ok: true, value }
    : inputError(`${operationName} requires non-empty string input "${key}"`);
}

function promptArgumentsInput(
  input: KotaJsonObject,
): { ok: true; value: KotaJsonObject } | { ok: false; result: ToolResult } {
  if (input.arguments === undefined) return { ok: true, value: {} };
  return isJsonObject(input.arguments)
    ? { ok: true, value: input.arguments }
    : inputError('prompts/get input "arguments" must be an object');
}

function inputError(message: string): { ok: false; result: ToolResult } {
  return { ok: false, result: { content: `MCP operation error: ${message}`, is_error: true } };
}

function remoteInputRequest(entry: McpOperationEntry, result: McpInputRequiredResult) {
  return {
    server: entry.client.getName(),
    tool: entry.kind,
    inputRequests: result.inputRequests ?? {},
    ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    ...(result._meta ? { resultMeta: result._meta } : {}),
  };
}

function unsupportedInput(
  entry: McpOperationEntry,
  result: McpInputRequiredResult,
  reason?: string,
): ToolResult {
  const detail = reason ?? inputRequiredUnavailableDetail(result);
  return {
    content:
      `MCP operation error: remote MCP operation "${entry.kind}" on server ` +
      `"${entry.client.getName()}" requires additional input, but ${detail}`,
    is_error: true,
    _meta: {
      mcp: {
        resultType: "input_required",
        protocolVersion: result.protocolVersion,
        server: entry.client.getName(),
        tool: entry.kind,
        ...(result.inputRequests ? { inputRequests: result.inputRequests } : {}),
        ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
        ...(result._meta ? { resultMeta: result._meta } : {}),
      },
    },
  };
}

function inputRequiredUnavailableDetail(result: McpInputRequiredResult): string {
  const asksForSampling = Object.values(result.inputRequests ?? {}).some(
    (request) => request.method === "sampling/createMessage",
  );
  return asksForSampling
    ? "the remote server requested sampling/createMessage, but no operator-approved sampling bridge is configured."
    : "this KOTA runtime cannot route remote input_required results yet.";
}
