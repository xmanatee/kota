/**
 * `antigravity-cli` agent harness — a text-only adapter around AGY CLI.
 *
 * Google's current Antigravity CLI exposes `agy --print` for non-interactive
 * text output. It does not expose a stable structured event stream equivalent
 * to Gemini CLI's `stream-json`, so this adapter is intentionally text-only.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessAuthProbe,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { probeNativeCliRuntime } from "#core/agent-harness/index.js";
import {
  ANTIGRAVITY_CLI_BINARY_NAME,
  abortedAntigravityCliResult,
  collectTextFromAntigravityCli,
} from "./cli-runner.js";

export const ANTIGRAVITY_CLI_AGENT_HARNESS_NAME = "antigravity-cli";

const ANTIGRAVITY_CONFIG_DIR = join(
  homedir(),
  ".gemini",
  "antigravity-cli",
);
const ANTIGRAVITY_SETTINGS_PATH = join(ANTIGRAVITY_CONFIG_DIR, "settings.json");

const ANTIGRAVITY_CLI_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason:
      "Antigravity CLI owns its own MCP configuration and does not host KOTA MCP servers.",
  },
  {
    runOption: "allowedTools",
    option: "allowedTools",
    reason: "Antigravity CLI owns its own tool catalog and permission model.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason: "Antigravity CLI owns its own tool catalog and permission model.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason:
      "Antigravity CLI tool calls cannot be routed through KOTA's canUseTool gate.",
  },
  {
    runOption: "scopePolicy",
    option: "scopePolicy",
    reason:
      "Antigravity CLI tool calls cannot be routed through KOTA's scope-policy evaluator.",
  },
  {
    runOption: "askOwner",
    option: "askOwner",
    reason:
      "Antigravity CLI cannot host KOTA's owner-question tool in this adapter.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason:
      "The AGY terminal UI cannot route approvals through KOTA's queue.",
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
    reason:
      "The antigravity-cli adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by Antigravity CLI.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason:
      "Antigravity CLI owns provider-specific reasoning controls outside this neutral surface.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason:
      "Antigravity CLI does not expose KotaAgentMessage frames through this adapter.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

function antigravityCliAuthReadiness(): AgentHarnessAuthProbe {
  const settingsState = existsSync(ANTIGRAVITY_SETTINGS_PATH)
    ? `settings file found at ${ANTIGRAVITY_SETTINGS_PATH}`
    : `settings file not found at ${ANTIGRAVITY_SETTINGS_PATH}`;
  return {
    kind: "harness-managed-login",
    status: "unverifiable",
    required: true,
    command: ANTIGRAVITY_CLI_BINARY_NAME,
    detail:
      `${settingsState}; Antigravity CLI stores Google session state in the OS secure keyring ` +
      "and current docs expose `/logout` but no stable headless auth-status command. " +
      "The settings file is not proof of login state.",
    summary:
      "Antigravity CLI auth cannot be verified non-interactively",
  };
}

function antigravityCliReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: ANTIGRAVITY_CLI_BINARY_NAME,
      versionArgs: ["--version"],
      required: true,
      missingSummary:
        "Antigravity CLI executable `agy` not found on PATH; install Antigravity CLI first",
    }),
    localAuth: antigravityCliAuthReadiness(),
    optionalRuntimes: [],
    unsupportedOptions: ANTIGRAVITY_CLI_UNSUPPORTED_OPTIONS,
  };
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "antigravity-cli" agent harness runs through AGY CLI and does not host KOTA MCP servers. ' +
        "Drop mcpServers or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot constrain AGY tools through KOTA allowedTools. ' +
        "Configure Antigravity permissions inside AGY instead.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot constrain AGY tools through KOTA disallowedTools. ' +
        "Configure Antigravity permissions inside AGY instead.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot route AGY tool calls through KOTA canUseTool. ' +
        "Use a KOTA-hosted tool-loop harness when KOTA must enforce tool policy.",
    );
  }
  if (options.scopePolicy !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot route AGY tool calls through KOTA scope policy. ' +
        "Use a KOTA-hosted tool-loop harness when KOTA must enforce scope policy.",
    );
  }
  if (options.askOwner !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot expose KOTA ask_owner to AGY CLI. ' +
        "Use deterministic askOwner workflow steps outside the agent step.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "antigravity-cli" agent harness cannot route AGY approvals through ' +
        "KOTA's operator approval queue. Use autonomous or passive mode.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "antigravity-cli" agent harness does not expose KOTA-managed session persistence. ' +
        "Drop persistSession.",
    );
  }
  if (options.resumeSessionId !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness does not expose KOTA-managed session resume. ' +
        "Drop resumeSessionId.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["antigravity-cli"].',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "antigravity-cli" agent harness does not support KOTA file checkpointing. ' +
        "Drop enableFileCheckpointing.",
    );
  }
  if (options.thinkingEnabled === true || options.thinkingBudget !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness does not expose KOTA thinkingEnabled/thinkingBudget. ' +
        "Select Antigravity model and reasoning behavior inside AGY.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage.",
    );
  }
}

function buildAntigravityPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    "## KOTA workflow rails",
    "Do not run `git commit`; stage changes and write the requested " +
      "commit-message artifact instead. Do not stop, restart, signal, or " +
      "control the daemon process that launched you.",
    "Antigravity CLI owns its native tool loop in this harness. If a task " +
      "requires a KOTA approval, KOTA tool registry call, or KOTA file " +
      "checkpoint that this adapter cannot provide, stop and report that boundary.",
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

export const antigravityCliAgentHarness: AgentHarness = {
  name: ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  description:
    "Runs Antigravity CLI (`agy --print`) as Google's current native CLI path with text-only output.",
  supportsMultiTurn: false,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: false,
  toolControl: "native",
  unsupportedRunOptions: ANTIGRAVITY_CLI_UNSUPPORTED_OPTIONS,
  readiness: antigravityCliReadiness,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    if (!options.model) {
      throw new Error(
        'The "antigravity-cli" agent harness requires an explicit model on the step or config.',
      );
    }
    if (options.abortController?.signal.aborted) {
      return abortedAntigravityCliResult();
    }
    return collectTextFromAntigravityCli({
      prompt: buildAntigravityPrompt(options),
      cwd: options.cwd ?? process.cwd(),
      model: options.model,
      passive: options.autonomyMode === "passive",
      authorityConfigPath: options.authorityConfigPath,
      env: options.env,
      abortController: options.abortController,
      writer,
    });
  },
};
