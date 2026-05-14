import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessStepOverrides,
  AgentHarnessWriter,
  AgentMcpServers,
} from "#core/agent-harness/index.js";
import { probeNodePackageRuntime } from "#core/agent-harness/index.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  ClaudeAgentMcpServers,
  ClaudeAgentSdkPermissionMode,
  ClaudeAgentSdkSettingSource,
  ClaudeAgentSdkStepOverrides,
} from "./executor.js";
import { executeWithAgentSDK } from "./executor.js";
import {
  createOwnerQuestionMcpServers,
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "./kota-tools-mcp.js";
import type { SDKSystemPrompt } from "./sdk-types.js";

export const CLAUDE_AGENT_HARNESS_NAME = "claude-agent-sdk";

const CLAUDE_UNSUPPORTED_OPTIONS = [
  {
    option: 'autonomyMode="supervised"',
    reason: "Claude Agent SDK has no native route into KOTA's approval queue.",
  },
] as const;

function claudeReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "agent-sdk",
    localRuntime: probeNodePackageRuntime({
      packageName: "@anthropic-ai/claude-agent-sdk",
      required: true,
    }),
    optionalRuntimes: [],
    unsupportedOptions: CLAUDE_UNSUPPORTED_OPTIONS,
  };
}

/**
 * Canonical model ids the claude-agent-sdk adapter knows it can serve. The
 * workflow validator gates step `model` strings through this catalog when
 * the active harness is claude. Non-claude harnesses (codex, gemini, thin)
 * do not declare a `validateModelId` and accept any non-empty string,
 * letting their wire layer reject unknown ids.
 */
export const CLAUDE_AGENT_SDK_KNOWN_MODELS: readonly string[] = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

function validateClaudeSdkModelId(modelId: string): void {
  if (!CLAUDE_AGENT_SDK_KNOWN_MODELS.includes(modelId)) {
    throw new Error(
      `unknown model "${modelId}" for harness "${CLAUDE_AGENT_HARNESS_NAME}" ` +
        `(known: ${CLAUDE_AGENT_SDK_KNOWN_MODELS.join(", ")})`,
    );
  }
}

const VALID_CLAUDE_SDK_PERMISSION_MODES: readonly ClaudeAgentSdkPermissionMode[] = [
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
];
const VALID_CLAUDE_SDK_SETTING_SOURCES: readonly ClaudeAgentSdkSettingSource[] = [
  "project",
  "local",
  "user",
];
const CLAUDE_STEP_OPTION_KEYS = ["permissionMode", "settingSources"] as const;

function validateClaudeSdkStepOptions(
  raw: unknown,
): AgentHarnessStepOverrides {
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

  const out: ClaudeAgentSdkStepOverrides = {};

  if (value.permissionMode !== undefined) {
    if (typeof value.permissionMode !== "string") {
      throw new Error("permissionMode must be a string");
    }
    if (
      !VALID_CLAUDE_SDK_PERMISSION_MODES.includes(
        value.permissionMode as ClaudeAgentSdkPermissionMode,
      )
    ) {
      throw new Error(
        `permissionMode must be one of ${VALID_CLAUDE_SDK_PERMISSION_MODES.join(", ")}`,
      );
    }
    out.permissionMode = value.permissionMode as ClaudeAgentSdkPermissionMode;
  }

  if (value.settingSources !== undefined) {
    if (!Array.isArray(value.settingSources)) {
      throw new Error("settingSources must be an array of strings");
    }
    const normalized: ClaudeAgentSdkSettingSource[] = [];
    for (const source of value.settingSources) {
      if (typeof source !== "string" || !source.trim()) {
        throw new Error("settingSources must be an array of non-empty strings");
      }
      if (
        !VALID_CLAUDE_SDK_SETTING_SOURCES.includes(
          source as ClaudeAgentSdkSettingSource,
        )
      ) {
        throw new Error(
          `settingSources entries must be one of ${VALID_CLAUDE_SDK_SETTING_SOURCES.join(", ")}`,
        );
      }
      normalized.push(source as ClaudeAgentSdkSettingSource);
    }
    out.settingSources = normalized;
  }

  if (out.permissionMode === undefined && out.settingSources === undefined) {
    return undefined;
  }
  return out;
}

const DEFAULT_SETTING_SOURCES: readonly ClaudeAgentSdkSettingSource[] = ["project"];

/**
 * Translate KOTA's autonomy posture into the claude-agent-sdk's native
 * `permissionMode` knob. The mapping mirrors the historical executor
 * defaults: `autonomous` runs without permission prompts, `passive` runs
 * the SDK's interactive permission UX so the agent must ask before any
 * write, and `supervised` is rejected because the SDK has no native
 * "queue every call through the operator approval queue" mode.
 */
function autonomyModeToPermissionMode(
  mode: AutonomyMode,
): ClaudeAgentSdkPermissionMode {
  switch (mode) {
    case "autonomous":
      return "bypassPermissions";
    case "passive":
      return "default";
    case "supervised":
      throw new Error(
        'The "claude-agent-sdk" agent harness cannot route tool calls through the operator approval queue. ' +
          "Use autonomyMode \"autonomous\" or \"passive\" instead.",
      );
  }
}

function isClaudeStepOverrides(
  value: AgentHarnessStepOverrides,
): value is ClaudeAgentSdkStepOverrides {
  return typeof value === "object" && value !== null;
}

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
  readiness: claudeReadiness,
  validateStepOptions: validateClaudeSdkStepOptions,
  validateModelId: validateClaudeSdkModelId,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    const {
      prompt,
      askOwner,
      systemPrompt,
      autonomyMode,
      harnessOverrides,
      mcpServers: callerMcpServers,
      ...rest
    } = options;
    // Neutral transport entries (`stdio | sse | http`) are structurally
    // compatible with the SDK's same-named shapes apart from a stricter
    // `tools?` element type; the adapter is the only place the two views
    // meet, so the widening cast sits here once.
    const mcpServers: ClaudeAgentMcpServers | undefined = askOwner
      ? mergeOwnerQuestionsMcpServer(callerMcpServers, askOwner.source)
      : (callerMcpServers as ClaudeAgentMcpServers | undefined);

    const claudeOverrides = isClaudeStepOverrides(harnessOverrides)
      ? harnessOverrides
      : undefined;
    // Per-step `harnessOptions["claude-agent-sdk"].permissionMode` wins when
    // present; otherwise translate KOTA's autonomy posture to the SDK's
    // native permission knob. Callers that omit `autonomyMode` get the
    // adapter's default ("autonomous"), preserving the historical behavior
    // of the bare `harness.run({ prompt })` call.
    const permissionMode =
      claudeOverrides?.permissionMode ??
      autonomyModeToPermissionMode(autonomyMode ?? "autonomous");
    const settingSources = claudeOverrides?.settingSources ?? DEFAULT_SETTING_SOURCES;

    return executeWithAgentSDK(
      prompt,
      {
        ...rest,
        mcpServers,
        systemPrompt: wrapSystemPromptForClaudeSDK(systemPrompt),
        settingSources,
        permissionMode,
      },
      writer,
    );
  },
};
