import type {
  AgentHarnessReadiness,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";
import { probeCurrentNodeRuntime } from "#core/agent-harness/index.js";

export const OPENAI_TOOLS_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "The openai-tools harness hosts KOTA tools directly, not MCP servers.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason: "The openai-tools harness cannot route tool calls through KOTA's approval queue.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "The openai-tools harness does not persist native sessions.",
  },
  {
    runOption: "resumeSessionId",
    option: "resumeSessionId",
    reason: "The openai-tools harness does not resume native sessions.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The openai-tools harness does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by this adapter.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort is the canonical reasoning control for this adapter.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "The adapter emits text deltas, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

export function openaiToolsReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "model-client",
    localRuntime: probeCurrentNodeRuntime({ required: true }),
    optionalRuntimes: [],
    unsupportedOptions: OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
  };
}

export function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "openai-tools" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "openai-tools" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "openai-tools" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "openai-tools" agent harness does not resume native sessions. ' +
        "Drop resumeSessionId or run claude-agent-sdk.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "openai-tools" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["openai-tools"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "openai-tools" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "openai-tools" agent harness does not host extended thinking. ' +
        "Drop thinkingEnabled/thinkingBudget or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "openai-tools" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}
