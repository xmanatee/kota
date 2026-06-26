import type {
  AgentHarnessReadiness,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";
import { probeCurrentNodeRuntime } from "#core/agent-harness/index.js";

export const OPENAI_TOOLS_UNSUPPORTED_OPTIONS = [
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
