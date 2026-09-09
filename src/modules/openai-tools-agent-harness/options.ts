import { z } from "zod";
import type {
  AgentHarnessReadiness,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";
import { probeCurrentNodeRuntime } from "#core/agent-harness/index.js";

export const OPENAI_TOOLS_UNSUPPORTED_OPTIONS = [
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
  resolveOpenaiToolsOptions(options.harnessOverrides);
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
}

export function resolveOpenaiToolsOptions(raw: unknown): { reasoning?: "provider-default" } {
  const parsed = z.object({ reasoning: z.literal("provider-default").optional() }).strict().safeParse(raw === undefined ? {} : raw);
  if (!parsed.success) throw new Error(`Invalid openai-tools harnessOptions: ${parsed.error.message}`);
  return parsed.data;
}
