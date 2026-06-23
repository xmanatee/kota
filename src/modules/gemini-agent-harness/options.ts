import type {
  AgentHarnessReadiness,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";
import {
  probeNativeCliRuntime,
  probeNodePackageRuntime,
} from "#core/agent-harness/index.js";

export const GEMINI_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "The Gemini SDK adapter hosts KOTA tools directly, not MCP servers.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason: "The adapter cannot route tool calls through KOTA's approval queue.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "The Gemini SDK loop does not persist native sessions.",
  },
  {
    runOption: "resumeSessionId",
    option: "resumeSessionId",
    reason: "The Gemini SDK loop does not resume native sessions.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The gemini adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by this adapter.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort maps to Gemini thinkingConfig.thinkingLevel instead.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "The adapter emits text deltas, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

export function geminiReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "provider-sdk",
    localRuntime: probeNodePackageRuntime({
      packageName: "@google/genai",
      required: true,
    }),
    optionalRuntimes: [
      probeNativeCliRuntime({
        binaryName: "gemini",
        versionArgs: ["--version"],
        required: false,
        missingSummary:
          "gemini CLI not found on PATH; this is informational because KOTA's gemini harness is SDK-backed",
      }),
    ],
    unsupportedOptions: GEMINI_UNSUPPORTED_OPTIONS,
  };
}

export function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "gemini" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "gemini" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "gemini" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "gemini" agent harness does not resume native sessions. ' +
        "Drop resumeSessionId or run claude-agent-sdk.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "gemini" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["gemini"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "gemini" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "gemini" agent harness does not host extended thinking through the ' +
        'thinkingEnabled toggle. Use the portable "effort" field - gemini maps ' +
        "it to thinkingConfig.thinkingLevel - or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "gemini" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}
