/**
 * `gemini-cli` agent harness — a subprocess adapter around Gemini CLI
 * headless structured output.
 *
 * This harness intentionally uses the installed `gemini` binary instead of
 * the Google Gen AI SDK. The CLI is the surface that honors cached Google
 * sign-in / Code Assist auth and its own tool loop inside KOTA's isolated OS
 * sandbox.
 */

import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { probeNativeCliRuntime } from "#core/agent-harness/index.js";
import { projectNativeCliScope } from "#core/agent-harness/native-cli-scope-policy.js";
import { geminiCliAuthReadiness } from "./auth-readiness.js";
import { collectTextFromGeminiCli, type GeminiCliApprovalMode } from "./cli-runner.js";
import {
  GEMINI_CLI_HOME_ENV,
  resolveGeminiCliHome,
} from "./runtime-home.js";

export const GEMINI_CLI_AGENT_HARNESS_NAME = "gemini-cli";

export function resolveGeminiCliIsolatedHostAuthEnv(
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  return {
    [GEMINI_CLI_HOME_ENV]: resolveGeminiCliHome(env),
  };
}

const GEMINI_CLI_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "Gemini CLI owns its own MCP configuration and does not host KOTA MCP servers.",
  },
  {
    runOption: "allowedTools",
    option: "allowedTools",
    reason: "Gemini CLI owns its own tool catalog and policy engine.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason: "Gemini CLI owns its own tool catalog and policy engine.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason: "Gemini CLI tool calls cannot be routed through KOTA's canUseTool gate.",
  },
  {
    runOption: "askOwner",
    option: "askOwner",
    reason: "Gemini CLI cannot host KOTA's owner-question tool in this adapter.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason: "The non-interactive CLI path cannot route approvals through KOTA's queue.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "KOTA-managed session persistence is not exposed by this adapter.",
  },
  {
    runOption: "resumeSessionId",
    option: "resumeSessionId",
    reason: "KOTA-managed session resume is not exposed by this adapter.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The gemini-cli adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by Gemini CLI.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Gemini CLI owns provider-specific thinking controls outside this neutral surface.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

function geminiCliReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: "gemini",
      versionArgs: ["--version"],
      required: true,
    }),
    localAuth: geminiCliAuthReadiness(),
    optionalRuntimes: [],
    unsupportedOptions: GEMINI_CLI_UNSUPPORTED_OPTIONS,
  };
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness runs through Gemini CLI and does not host KOTA MCP servers. ' +
        "Drop mcpServers or run the claude-agent-sdk harness.",
    );
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness cannot constrain Gemini CLI tools through KOTA allowedTools. ' +
        "Drop allowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness cannot constrain Gemini CLI tools through KOTA disallowedTools. ' +
        "Drop disallowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness cannot route Gemini CLI tool calls through KOTA canUseTool. ' +
        "Drop canUseTool or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.askOwner !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness cannot expose KOTA ask_owner to Gemini CLI. ' +
        "Use deterministic askOwner workflow steps instead.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "gemini-cli" agent harness runs non-interactively and cannot route tool calls ' +
        "through KOTA's operator approval queue. Use autonomous or passive mode.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "gemini-cli" agent harness does not expose KOTA-managed session persistence. ' +
        "Drop persistSession.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness does not expose KOTA-managed session resume. ' +
        "Drop resumeSessionId.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["gemini-cli"].',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "gemini-cli" agent harness does not support KOTA file checkpointing. ' +
        "Drop enableFileCheckpointing.",
    );
  }
  if (options.thinkingEnabled === true || options.thinkingBudget !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness does not expose KOTA thinkingEnabled/thinkingBudget. ' +
        "Select a Gemini CLI model or settings profile instead.",
    );
  }
}

function geminiApprovalMode(
  executionMode: "bounded-edits" | "plan",
): GeminiCliApprovalMode {
  return executionMode === "plan" ? "plan" : "auto_edit";
}

function buildGeminiCliPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    "## KOTA workflow rails",
    "Do not run `git commit`; stage changes and write the requested " +
      "commit-message artifact instead. Do not stop, restart, signal, or " +
      "control the daemon process that launched you.",
    "Gemini CLI owns its native tool loop in this harness. If a task requires " +
      "a KOTA approval, KOTA tool registry call, or KOTA file checkpoint that " +
      "this adapter cannot provide, stop and report that boundary.",
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

export const geminiCliAgentHarness: AgentHarness = {
  name: GEMINI_CLI_AGENT_HARNESS_NAME,
  description:
    "Runs the installed Gemini CLI in a KOTA-owned native sandbox; authenticated launches remain disabled until provider auth can be brokered outside the native tool tree.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: true,
  toolControl: "native",
  nativeAbortQuarantine: "confirmed-stop",
  unsupportedRunOptions: GEMINI_CLI_UNSUPPORTED_OPTIONS,
  readiness: geminiCliReadiness,
  resolveIsolatedHostAuthEnv: resolveGeminiCliIsolatedHostAuthEnv,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    if (!options.model) {
      throw new Error(
        'The "gemini-cli" agent harness requires an explicit model on the step or config.',
      );
    }
    const scope = projectNativeCliScope({
      cwd: options.cwd ?? process.cwd(),
      autonomyMode: options.autonomyMode,
      scopePolicy: options.scopePolicy,
    });
    const execution = collectTextFromGeminiCli({
      prompt: buildGeminiCliPrompt(options),
      cwd: options.cwd ?? process.cwd(),
      model: options.model,
      approvalMode: geminiApprovalMode(scope.executionMode),
      writableRoots: scope.writableRoots,
      authorityConfigPath: options.authorityConfigPath,
      env: options.env,
      abortController: options.abortController,
      writer,
      onMessage: options.onMessage,
    });
    options.abortQuarantine?.register(async () => {
      await execution.then(
        () => undefined,
        () => undefined,
      );
    });
    return execution;
  },
};
