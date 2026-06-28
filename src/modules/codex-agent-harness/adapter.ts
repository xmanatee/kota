/**
 * `codex` agent harness — a subprocess adapter around `codex exec --json`.
 *
 * This harness intentionally uses the installed Codex CLI instead of the
 * OpenAI Agents SDK. The CLI is the surface that honors `codex login` /
 * ChatGPT-plan subscription auth, so KOTA's default Codex preset must route
 * through it rather than requiring `OPENAI_API_KEY`.
 */

import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import {
  probeNativeCliAuth,
  probeNativeCliRuntime,
} from "#core/agent-harness/index.js";
import { collectTextFromCodexCli } from "./cli-runner.js";

export const CODEX_AGENT_HARNESS_NAME = "codex";

const CODEX_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "Codex CLI owns its own tool runtime and does not host KOTA MCP servers.",
  },
  {
    runOption: "allowedTools",
    option: "allowedTools",
    reason: "Codex CLI tool policy cannot be constrained through KOTA allowedTools.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason: "Codex CLI tool policy cannot be constrained through KOTA disallowedTools.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason: "Codex CLI tool calls cannot be routed through KOTA's canUseTool gate.",
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
    reason: "The codex adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by Codex CLI.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort maps to Codex CLI model_reasoning_effort instead.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

function codexReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: "codex",
      versionArgs: ["--version"],
      required: true,
    }),
    localAuth: probeNativeCliAuth({
      binaryName: "codex",
      statusArgs: ["login", "status"],
      required: true,
      readyPattern: /logged in using chatgpt/i,
      missingPattern:
        /not logged in|not authenticated|logged out|no login|login required|api key/i,
      readySummary: "Codex ChatGPT login active",
      missingSummary: "Codex ChatGPT login not active; run `codex login`",
    }),
    optionalRuntimes: [],
    unsupportedOptions: CODEX_UNSUPPORTED_OPTIONS,
  };
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "codex" agent harness runs through Codex CLI and does not host KOTA MCP servers. ' +
        "Drop mcpServers or run the claude-agent-sdk harness.",
    );
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "codex" agent harness cannot constrain Codex CLI tools through KOTA allowedTools. ' +
        "Drop allowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "codex" agent harness cannot constrain Codex CLI tools through KOTA disallowedTools. ' +
        "Drop disallowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "codex" agent harness cannot route Codex CLI tool calls through KOTA canUseTool. ' +
        "Drop canUseTool or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "codex" agent harness runs non-interactively and cannot route tool calls ' +
        "through KOTA's operator approval queue. Use autonomous or passive mode.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "codex" agent harness does not expose KOTA-managed session persistence. ' +
        "Drop persistSession.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "codex" agent harness does not expose KOTA-managed session resume. ' +
        "Drop resumeSessionId.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "codex" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["codex"].',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "codex" agent harness does not support KOTA file checkpointing. ' +
        "Drop enableFileCheckpointing.",
    );
  }
  if (options.thinkingEnabled === true || options.thinkingBudget !== undefined) {
    throw new Error(
      'The "codex" agent harness maps portable effort to Codex CLI reasoning. ' +
        "Drop thinkingEnabled/thinkingBudget and use effort.",
    );
  }
}

function codexSandboxMode(
  options: AgentHarnessRunOptions,
): "read-only" | "workspace-write" {
  return options.autonomyMode === "passive" ? "read-only" : "workspace-write";
}

function buildCodexPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    "## KOTA workflow rails",
    "Do not run `git commit`; stage changes and write the requested " +
      "commit-message artifact instead. Do not stop, restart, signal, or " +
      "control the daemon process that launched you.",
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

export const codexAgentHarness: AgentHarness = {
  name: CODEX_AGENT_HARNESS_NAME,
  description:
    "Runs the installed Codex CLI (`codex exec --json`) so KOTA uses Codex ChatGPT-plan subscription auth from `codex login`.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: true,
  toolControl: "native",
  unsupportedRunOptions: CODEX_UNSUPPORTED_OPTIONS,
  readiness: codexReadiness,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    if (!options.model) {
      throw new Error(
        'The "codex" agent harness requires an explicit model on the step or config.',
      );
    }
    return collectTextFromCodexCli({
      prompt: buildCodexPrompt(options),
      cwd: options.cwd ?? process.cwd(),
      model: options.model,
      effort: options.effort,
      sandbox: codexSandboxMode(options),
      env: options.env,
      abortController: options.abortController,
      writer,
      onMessage: options.onMessage,
    });
  },
};
