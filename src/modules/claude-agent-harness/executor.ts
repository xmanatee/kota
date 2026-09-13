import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getSessionInfo, importSessionToStore, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { resolveAgentFilesystemWriteRoots } from "#core/agent-harness/agent-write-scope-roots.js";
import { composeCanUseTools } from "#core/agent-harness/guards.js";
import { pathIsWithinRoots } from "#core/agent-harness/machine-authority-sandbox-paths.js";
import { agentConversationRoot, SessionRecoveryError } from "#core/agent-harness/session-continuity.js";
import type {
  AgentCanUseTool,
  AgentEffort,
  KotaAgentMessage,
} from "#core/agent-harness/types.js";
import { type AgentUsage, pricedAgentUsage } from "#core/agent-harness/usage.js";
import type { AgentWriteScope } from "#core/agents/agent-types.js";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPaths } from "#core/daemon/scope-authority-operator-token.js";
import type { ProcessSpawnObserver } from "#core/execution/process-supervisor.js";
import { resolvePathIdentities } from "#core/util/real-path.js";
import { normalizeCanUseTool } from "./executor-permissions.js";
import {
  detectLocalClaudeCodeExecutable,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor-process.js";
import {
  extractStatusText,
  extractText,
  getSessionId,
  type RawSdkMessage,
  toKotaAgentMessages,
} from "./executor-sdk-messages.js";
import type { SDKQueryOptions, SDKSystemPrompt } from "./sdk-types.js";
import { createClaudeSessionStore } from "./session-store.js";

export { normalizePermissionResult } from "./executor-permissions.js";
export {
  detectLocalClaudeCodeExecutable,
  SDK_ABORT_FORCE_KILL_MS,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor-process.js";

/**
 * Claude-agent-sdk-shaped permission and setting-source literals. The
 * neutral protocol no longer surfaces these names; they live on this
 * adapter's per-step `harnessOptions["claude-agent-sdk"]` carve-out and
 * inside the SDK options the executor builds.
 */
export type ClaudeAgentSdkPermissionMode =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

export type ClaudeAgentSdkSettingSource = "project" | "local" | "user";

export type ClaudeAgentSdkStepOverrides = {
  permissionMode?: ClaudeAgentSdkPermissionMode;
  settingSources?: readonly ClaudeAgentSdkSettingSource[];
};

export type ClaudeAgentMcpServers = Record<string, McpServerConfig>;

export type ExecutorWriter = { write(text: string): boolean };

export type ExecutorOptions = {
  model?: string;
  cwd?: string;
  scopeRoot?: string;
  agentWriteScope?: AgentWriteScope;
  agentReadScope?: readonly string[];
  agentOutputDir?: string;
  verbose?: boolean;
  systemPrompt?: SDKSystemPrompt;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: ClaudeAgentMcpServers;
  permissionMode?: ClaudeAgentSdkPermissionMode;
  persistSession?: boolean;
  sessionStorageDir?: string;
  resumeSessionId?: string;
  onSessionId?: (id: string) => void;
  effort: AgentEffort;
  settingSources?: readonly ClaudeAgentSdkSettingSource[];
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string>;
  authorityConfigPath?: string;
  abortController?: AbortController;
  onProcessSpawn?: ProcessSpawnObserver;
  enableFileCheckpointing?: boolean;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  canUseTool?: AgentCanUseTool;
};

export type ExecutorResult = {
  text: string;
  streamedText: string;
  sessionId?: string;
  turns: number;
  usage: AgentUsage;
  subtype?: string;
  isError: boolean;
};

export function buildQueryOptions(options: ExecutorOptions): SDKQueryOptions {
  const cwd = options.cwd ?? process.cwd();
  const agentWriteRoots = resolveAgentFilesystemWriteRoots(
    cwd,
    options.agentWriteScope,
    options.agentOutputDir,
  );
  const requestedPermissionMode = options.permissionMode ?? "bypassPermissions";
  const permissionMode =
    options.canUseTool && requestedPermissionMode === "bypassPermissions"
      ? "default"
      : requestedPermissionMode;
  const thinking = options.thinkingEnabled
    ? { type: "enabled" as const, budgetTokens: Math.max(1024, options.thinkingBudget ?? 10_000) }
    : undefined;
  const authorityConfigPath = options.authorityConfigPath ?? getGlobalConfigPath();
  const authorityTokenPaths = scopeAuthorityOperatorTokenPaths(authorityConfigPath);
  const nativeSessionRoot = join(options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(options.env?.HOME ?? homedir(), ".claude"), "projects");
  const sessionRoots = [...new Set([
    nativeSessionRoot,
    ...[cwd, options.scopeRoot ?? cwd, process.cwd()].map(agentConversationRoot),
    ...(options.sessionStorageDir === undefined ? [] : [options.sessionStorageDir]),
  ].flatMap((path) => resolvePathIdentities(path, cwd)))];
  const protectSessions: AgentCanUseTool = async (name, input) => {
    const paths = [input.file_path, input.path, input.notebook_path].filter((path): path is string => typeof path === "string");
    if (name === "Grep" || name === "Glob") paths.push(typeof input.path === "string" ? input.path : cwd);
    if (paths.some((path) => resolvePathIdentities(resolve(cwd, path), cwd).some((target) =>
      pathIsWithinRoots(target, sessionRoots) || ((name === "Grep" || name === "Glob") && sessionRoots.some((root) => pathIsWithinRoots(root, [target])))
    ))) return { behavior: "deny", message: "Provider transcripts are protected runtime state. Use sandboxed commands or KOTA filesystem tools for searches that span runtime storage." };
    return { behavior: "allow", updatedInput: input };
  };
  const permissionGuard = options.canUseTool === undefined
    ? protectSessions
    : composeCanUseTools(options.canUseTool, protectSessions);
  const guardedPreToolUseTools = new Set([
    "Read",
    "Glob",
    "Grep",
    "NotebookRead",
    "Skill",
    // Sandboxed Bash may be auto-approved without canUseTool. The write-scope
    // guard treats opaque commands as writes and therefore denies them for a
    // review-only invocation before that SDK shortcut can run.
    "Bash",
  ]);
  return {
    model: options.model,
    maxTurns: options.maxTurns,
    systemPrompt: options.systemPrompt,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    mcpServers: options.mcpServers,
    permissionMode: permissionMode === "bypassPermissions" ? "default" : permissionMode,
    cwd,
    persistSession: options.persistSession,
    resume: options.resumeSessionId,
    ...(options.persistSession !== false && options.sessionStorageDir !== undefined ? {
      sessionStore: createClaudeSessionStore(join(options.sessionStorageDir, "claude"), options.onSessionId),
      sessionStoreFlush: "eager" as const,
    } : {}),
    effort: options.effort,
    settingSources: options.settingSources
      ? [...options.settingSources]
      : undefined,
    pathToClaudeCodeExecutable:
      options.pathToClaudeCodeExecutable ?? detectLocalClaudeCodeExecutable(),
    ...(options.env !== undefined
      ? { env: { ...stringProcessEnv(), ...options.env } }
      : {}),
    abortController: options.abortController,
    enableFileCheckpointing: options.enableFileCheckpointing,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    thinking,
    spawnClaudeCodeProcess: (spawnOptions) =>
      spawnClaudeCodeProcessWithAbortKill(spawnOptions, options.onProcessSpawn),
    canUseTool: normalizeCanUseTool(permissionGuard),
    // Read built-ins and sandboxed Bash may be auto-approved without
    // canUseTool. This hook runs their machine guards before that shortcut,
    // including on a resumed native session.
    hooks: { PreToolUse: [{ hooks: [async (input, toolUseID, hookOptions) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const guard = guardedPreToolUseTools.has(input.tool_name) ? permissionGuard : protectSessions;
      const decision = await guard(input.tool_name, z.record(z.string(), z.json()).parse(input.tool_input), { signal: hookOptions.signal, toolUseId: toolUseID ?? input.tool_use_id });
      return decision.behavior === "deny" ? { hookSpecificOutput: {
        hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const,
        permissionDecisionReason: decision.message,
      } } : {};
    }] }] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // Evidence reviewers carry an invocation-local read allowlist. Keep the
      // SDK callback mandatory in addition to the pre-tool guard for Bash.
      autoAllowBashIfSandboxed: options.agentReadScope === undefined,
      filesystem: {
        allowWrite: agentWriteRoots ?? [cwd],
        denyWrite: [dirname(authorityConfigPath), ...authorityTokenPaths, ...sessionRoots],
        denyRead: [...authorityTokenPaths, ...sessionRoots],
      },
    },
  };
}

function stringProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (!abortSignal?.aborted) return;
  const reason = abortSignal.reason;
  throw reason instanceof Error ? reason : new Error("Agent execution aborted");
}

export async function executeWithAgentSDK(
  prompt: string,
  options: ExecutorOptions,
  writer?: ExecutorWriter,
): Promise<ExecutorResult> {
  const out = writer ?? process.stdout;
  const queryOptions = buildQueryOptions(options);
  if (options.resumeSessionId !== undefined && queryOptions.sessionStore !== undefined) {
    const lookup = { dir: queryOptions.cwd, sessionStore: queryOptions.sessionStore };
    if (await getSessionInfo(options.resumeSessionId, lookup) === undefined) {
      // Older SDK conversations may predate the protected mirror. Import only
      // the explicitly requested native identity through the SDK's own reader.
      if (await getSessionInfo(options.resumeSessionId, { dir: queryOptions.cwd }) === undefined) {
        throw new SessionRecoveryError("The owned Claude conversation and its native transcript are missing or expired; retained work remains available.");
      }
      await importSessionToStore(options.resumeSessionId, queryOptions.sessionStore, { dir: queryOptions.cwd });
    }
  }

  const streamedChunks: string[] = [];
  let resultMessage: RawSdkMessage | undefined;
  let sessionId: string | undefined;
  let turns = 0;
  const abortSignal = options.abortController?.signal;
  throwIfAborted(abortSignal);

  for await (const rawMessage of sdkQuery({ prompt, options: queryOptions })) {
    throwIfAborted(abortSignal);

    const message = rawMessage as RawSdkMessage;
    if (message.type === "system" && message.subtype === "mirror_error") throw new Error("Claude session preservation failed; the provider-native transcript was retained for recovery.");

    const messageSessionId = getSessionId(message);
    if (messageSessionId) {
      sessionId = messageSessionId;
      options.onSessionId?.(sessionId);
    }
    if (options.onMessage) {
      for (const frame of toKotaAgentMessages(message)) {
        await options.onMessage(frame);
      }
    }

    if (message.type === "assistant") {
      turns += 1;
      const text = extractText(message);
      if (text) {
        out.write(text);
        streamedChunks.push(text);
      }
      continue;
    }

    if (message.type === "result") {
      resultMessage = message;
      if (typeof message.num_turns === "number") turns = message.num_turns;
      break;
    }

    if (options.verbose) {
      const statusText = extractStatusText(message);
      if (statusText) process.stderr.write(`[agent-sdk] ${statusText}\n`);
    }
  }

  const streamedText = streamedChunks.join("");
  const text = resultMessage?.result ?? streamedText;

  return {
    text,
    streamedText,
    sessionId,
    turns,
    usage: pricedAgentUsage(
      resultMessage?.usage?.input_tokens,
      resultMessage?.usage?.output_tokens,
      resultMessage?.total_cost_usd,
    ),
    subtype: resultMessage?.subtype,
    isError:
      resultMessage?.is_error === true ||
      Boolean(resultMessage?.subtype?.startsWith("error_")),
  };
}
