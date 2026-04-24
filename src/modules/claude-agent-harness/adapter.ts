import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  AgentMcpServers,
  AgentPermissionMode,
  AgentSettingSource,
} from "#core/agent-harness/index.js";
import type { ClaudeAgentMcpServers } from "./executor.js";
import { executeWithAgentSDK } from "./executor.js";
import {
  createOwnerQuestionMcpServers,
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "./kota-tools-mcp.js";
import type { SDKSystemPrompt } from "./sdk-types.js";

export const CLAUDE_AGENT_HARNESS_NAME = "claude-agent-sdk";

const VALID_CLAUDE_SDK_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
];
const VALID_CLAUDE_SDK_SETTING_SOURCES: readonly AgentSettingSource[] = [
  "project",
  "local",
  "user",
];
const CLAUDE_STEP_OPTION_KEYS = ["permissionMode", "settingSources"] as const;

function validateClaudeSdkStepOptions(
  raw: unknown,
): Partial<AgentHarnessRunOptions> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("must be an object");
  }
  const value = raw as Record<string, unknown>;
  const allowed = new Set<string>(CLAUDE_STEP_OPTION_KEYS);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `unknown key(s): ${unknownKeys.map((k) => `"${k}"`).join(", ")}`,
    );
  }

  const out: Partial<AgentHarnessRunOptions> = {};

  if (value.permissionMode !== undefined) {
    if (typeof value.permissionMode !== "string") {
      throw new Error("permissionMode must be a string");
    }
    if (
      !VALID_CLAUDE_SDK_PERMISSION_MODES.includes(
        value.permissionMode as AgentPermissionMode,
      )
    ) {
      throw new Error(
        `permissionMode must be one of ${VALID_CLAUDE_SDK_PERMISSION_MODES.join(", ")}`,
      );
    }
    out.permissionMode = value.permissionMode as AgentPermissionMode;
  }

  if (value.settingSources !== undefined) {
    if (!Array.isArray(value.settingSources)) {
      throw new Error("settingSources must be an array of strings");
    }
    const normalized: AgentSettingSource[] = [];
    for (const source of value.settingSources) {
      if (typeof source !== "string" || !source.trim()) {
        throw new Error("settingSources must be an array of non-empty strings");
      }
      if (
        !VALID_CLAUDE_SDK_SETTING_SOURCES.includes(source as AgentSettingSource)
      ) {
        throw new Error(
          `settingSources entries must be one of ${VALID_CLAUDE_SDK_SETTING_SOURCES.join(", ")}`,
        );
      }
      normalized.push(source as AgentSettingSource);
    }
    out.settingSources = normalized;
  }

  if (out.permissionMode === undefined && out.settingSources === undefined) {
    return undefined;
  }
  return out;
}

const DEFAULT_SETTING_SOURCES: NonNullable<AgentHarnessRunOptions["settingSources"]> = ["project"];
// Workflow agent steps ran by this adapter skip the SDK permission prompt
// unless the step explicitly opts into a stricter mode via its
// `harnessOptions["claude-agent-sdk"].permissionMode` override. Declared
// inside the adapter so the neutral step protocol stays harness-free.
const DEFAULT_PERMISSION_MODE: NonNullable<AgentHarnessRunOptions["permissionMode"]> =
  "bypassPermissions";

function mergeOwnerQuestionsMcpServer(
  existing: AgentMcpServers | undefined,
  source: string,
): ClaudeAgentMcpServers {
  // Owner-question injection must never overwrite caller-supplied MCP servers
  // (modules may have registered their own). If the caller already wired an
  // owner-questions server under this name, keep theirs; otherwise add ours.
  //
  // Caller-supplied `existing` entries are the harness-neutral transport
  // variants (`stdio | sse | http`). The merged result adds the claude-only
  // in-process `sdk` entry, so the return widens to the adapter's
  // `ClaudeAgentMcpServers` shape. Neutral transport entries are
  // structurally compatible with the SDK's same-named wire types apart
  // from a stricter `tools?` element type, which the adapter does not
  // populate here; a single cast at this one boundary keeps the neutral
  // protocol ignorant of the claude-sdk types.
  const owner = createOwnerQuestionMcpServers(source);
  if (existing === undefined) return owner;
  const wired = existing as ClaudeAgentMcpServers;
  if (KOTA_OWNER_QUESTIONS_MCP_SERVER in wired) return wired;
  return { ...wired, ...owner };
}

/**
 * Wrap the harness-neutral portable prompt text in the claude-agent-sdk
 * `claude_code` preset envelope the SDK expects. The preset is claude-specific
 * wire shape — only this adapter knows the envelope exists; the rest of KOTA
 * hands around plain strings.
 */
function wrapSystemPromptForClaudeSDK(
  systemPrompt: string | undefined,
): SDKSystemPrompt {
  if (systemPrompt === undefined || systemPrompt.length === 0) {
    return { type: "preset", preset: "claude_code" };
  }
  return { type: "preset", preset: "claude_code", append: systemPrompt };
}

export const claudeAgentHarness: AgentHarness = {
  name: CLAUDE_AGENT_HARNESS_NAME,
  description:
    "Runs agent steps through Anthropic's @anthropic-ai/claude-agent-sdk loop with full tool access.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: KOTA_OWNER_QUESTIONS_MCP_TOOL,
  emitsAgentMessageStream: true,
  validateStepOptions: validateClaudeSdkStepOptions,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    const { prompt, askOwner, settingSources, permissionMode, systemPrompt, ...rest } = options;
    // Neutral transport entries (`stdio | sse | http`) are structurally
    // compatible with the SDK's same-named shapes apart from a stricter
    // `tools?` element type; the adapter is the only place the two views
    // meet, so the widening cast sits here once.
    const mcpServers: ClaudeAgentMcpServers | undefined = askOwner
      ? mergeOwnerQuestionsMcpServer(rest.mcpServers, askOwner.source)
      : (rest.mcpServers as ClaudeAgentMcpServers | undefined);
    return executeWithAgentSDK(
      prompt,
      {
        ...rest,
        mcpServers,
        systemPrompt: wrapSystemPromptForClaudeSDK(systemPrompt),
        // Claude-SDK default: load project settings. Explicit caller values
        // (including an empty array meaning "load nothing") win.
        settingSources: settingSources ?? DEFAULT_SETTING_SOURCES,
        // Workflow steps omit permissionMode on the neutral step shape; the
        // adapter applies the workflow-agent default here so autonomy
        // definitions do not re-state the field. Explicit caller values
        // (including `"default"` from passive autonomy mode) still win.
        permissionMode: permissionMode ?? DEFAULT_PERMISSION_MODE,
      },
      writer,
    );
  },
};
