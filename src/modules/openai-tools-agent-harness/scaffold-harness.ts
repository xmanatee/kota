import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import { runOpenaiToolsLoop } from "./adapter.js";
import {
  DEFAULT_SCAFFOLD_MAX_TURNS,
  OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
  OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME,
} from "./constants.js";
import type { OpenaiToolsLoopMode } from "./loop-mode.js";
import {
  OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
  openaiToolsReadiness,
} from "./options.js";
import {
  buildScaffoldSystemPrompt,
  executeScaffoldToolCalls,
  parseScaffoldJsonAction,
  selectScaffoldToolDefinitions,
} from "./scaffold-tools.js";
import type { ValidatedToolUseBlock } from "./tool-loop.js";

const VERIFICATION_REQUIRED_MESSAGE =
  "scaffold_verify is required after scaffold_edit or scaffold_apply_patch before the scaffold harness can accept a final response.";

function successfulEditPath(block: ValidatedToolUseBlock, isError: boolean): boolean {
  return (
    !isError &&
    (block.name === "scaffold_edit" || block.name === "scaffold_apply_patch")
  );
}

function successfulVerifier(block: ValidatedToolUseBlock, isError: boolean): boolean {
  return !isError && block.name === "scaffold_verify";
}

function createScaffoldLoopMode(): OpenaiToolsLoopMode {
  let verificationRequired = false;
  return {
    systemPrompt: buildScaffoldSystemPrompt,
    defaultMaxTurns: DEFAULT_SCAFFOLD_MAX_TURNS,
    selectTools: (allowed, disallowed, includeAskOwner) =>
      selectScaffoldToolDefinitions(allowed, disallowed, includeAskOwner),
    executeTools: async (toolBlocks, options, context) => {
      const results = await executeScaffoldToolCalls(toolBlocks, options, context);
      for (const [index, block] of toolBlocks.entries()) {
        const isError = results[index]?.is_error === true;
        if (successfulVerifier(block, isError)) verificationRequired = false;
        if (successfulEditPath(block, isError)) verificationRequired = true;
      }
      return results;
    },
    parseJsonAction: parseScaffoldJsonAction,
    finalizeResponse: (result) =>
      verificationRequired
        ? {
            ...result,
            text: VERIFICATION_REQUIRED_MESSAGE,
            isError: true,
            subtype: "scaffold_verification_required",
          }
        : result,
  };
}

export const openaiToolsScaffoldAgentHarness: AgentHarness = {
  name: OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME,
  description:
    "Opt-in scaffolded OpenAI-compatible loop for weaker or local models. Presents compound inspect/search-read/edit/patch/run/verify tools, accepts JSON-action fallback output, and expands every action through KOTA's guarded tool runner.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: true,
  toolControl: "kota",
  readiness: openaiToolsReadiness,
  unsupportedRunOptions: OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    if (options.askOwner) {
      return runWithAskOwnerSource(options.askOwner.source, () =>
        runOpenaiToolsLoop(options, writer, createScaffoldLoopMode()),
      );
    }
    return runOpenaiToolsLoop(options, writer, createScaffoldLoopMode());
  },
};
