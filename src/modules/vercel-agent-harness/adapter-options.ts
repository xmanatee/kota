import type {
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";

export const VERCEL_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "The vercel harness hosts KOTA tools directly, not MCP servers.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "The vercel harness does not persist native sessions.",
  },
  {
    runOption: "resumeSessionId",
    option: "resumeSessionId",
    reason: "The vercel harness does not resume native sessions.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The vercel harness does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by this adapter.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort maps to provider-specific reasoning settings instead.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "The adapter emits text deltas, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

export function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "vercel" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "vercel" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "vercel" agent harness does not resume native sessions. ' +
        "Drop resumeSessionId or run claude-agent-sdk.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "vercel" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["vercel"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "vercel" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "vercel" agent harness does not host extended thinking. ' +
        'Drop thinkingEnabled/thinkingBudget - use the portable "effort" field, ' +
        "or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "vercel" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}
