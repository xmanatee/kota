/** `antigravity-cli` agent harness around AGY's headless event stream. */

import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessReadinessRequest,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessRuntimeProbeDeps,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import {
  buildNativeCliWorkflowRails,
  probeNativeCliRuntime,
} from "#core/agent-harness/index.js";
import { projectNativeCliScope } from "#core/agent-harness/native-cli-scope-policy.js";
import { antigravityCliAuthReadiness } from "./auth-readiness.js";
import { abortedAntigravityCliResult } from "./cli-result.js";
import {
  ANTIGRAVITY_CLI_BINARY_NAME,
  ANTIGRAVITY_CLI_UNCONFIRMED_STOP_SUBTYPE,
  collectTextFromAntigravityCli,
} from "./cli-runner.js";
import { resolveAntigravityCliModelEffortReadiness } from "./model-readiness.js";
import {
  ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV,
  resolveAntigravityCliKeychainPath,
} from "./runtime-home.js";

export const ANTIGRAVITY_CLI_AGENT_HARNESS_NAME = "antigravity-cli";

export function resolveAntigravityCliIsolatedHostAuthEnv(
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const keychainPath = resolveAntigravityCliKeychainPath(env);
  return keychainPath === undefined
    ? {}
    : { [ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]: keychainPath };
}

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
    reason:
      "Antigravity CLI owns its tool catalog; KOTA constrains its process boundary rather than individual native tools.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason:
      "Antigravity CLI owns its tool catalog; KOTA constrains its process boundary rather than individual native tools.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason:
      "Antigravity CLI tool calls cannot be routed through KOTA's canUseTool gate.",
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
] as const satisfies readonly AgentHarnessUnsupportedOption[];

export function antigravityCliReadiness(
  request?: AgentHarnessReadinessRequest,
  deps?: AgentHarnessRuntimeProbeDeps,
): AgentHarnessReadiness {
  const localAuth = antigravityCliAuthReadiness(deps);
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: ANTIGRAVITY_CLI_BINARY_NAME,
      versionArgs: ["--version"],
      minimumVersion: "1.1.10",
      required: true,
      missingSummary:
        "Antigravity CLI executable `agy` not found on PATH; install Antigravity CLI first",
    }, deps),
    localAuth,
    ...(request !== undefined
      ? {
          modelEffort: resolveAntigravityCliModelEffortReadiness(
            request,
            localAuth,
          ),
        }
      : {}),
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
        "Use KOTA scope policy or a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot constrain AGY tools through KOTA disallowedTools. ' +
        "Use KOTA scope policy or a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "antigravity-cli" agent harness cannot route AGY tool calls through KOTA canUseTool. ' +
        "Use a KOTA-hosted tool-loop harness when KOTA must enforce tool policy.",
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
}

function buildAntigravityPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    ...buildNativeCliWorkflowRails([
      "Antigravity CLI owns its native tool loop in this harness. If a task " +
        "requires a KOTA approval, KOTA tool registry call, or KOTA file " +
        "checkpoint that this adapter cannot provide, stop and report that boundary.",
    ]),
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

export const antigravityCliAgentHarness: AgentHarness = {
  name: ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  description:
    "Runs Antigravity CLI (`agy --print --output-format stream-json`) as Google's current native CLI path.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: true,
  toolControl: "native",
  nativeAbortQuarantine: "confirmed-stop",
  unsupportedRunOptions: ANTIGRAVITY_CLI_UNSUPPORTED_OPTIONS,
  readiness: antigravityCliReadiness,
  resolveIsolatedHostAuthEnv: resolveAntigravityCliIsolatedHostAuthEnv,
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
    const cwd = options.cwd ?? process.cwd();
    const scopeRoot = options.scopeRoot ?? cwd;
    const scope = projectNativeCliScope({
      cwd,
      autonomyMode: options.autonomyMode,
      scopePolicy: options.scopePolicy,
      agentWriteScope: options.agentWriteScope,
      agentOutputDir: options.agentOutputDir,
    });
    const runtimeWritableRoots = [
      options.agentOutputDir,
      options.env?.KOTA_RUN_TEMP_DIR,
      options.env?.KOTA_RUN_ARTIFACT_DIR,
    ].filter((path): path is string => path !== undefined);
    const execution = collectTextFromAntigravityCli({
      prompt: buildAntigravityPrompt(options),
      cwd,
      runtimeStateRoot: join(scopeRoot, ".kota"),
      model: options.model,
      effort: options.effort,
      resumeSessionId: options.resumeSessionId,
      outputSchema: options.outputSchema,
      readOnly: scope.executionMode === "plan",
      writableRoots: scope.writableRoots,
      runtimeWritableRoots,
      authorityConfigPath: options.authorityConfigPath,
      env: options.env,
      abortController: options.abortController,
      writer,
      onMessage: options.onMessage,
      onProcessSpawn: options.onProcessSpawn,
    });
    options.abortQuarantine?.register(async () => {
      const result = await execution;
      if (result.subtype === ANTIGRAVITY_CLI_UNCONFIRMED_STOP_SUBTYPE) {
        throw new Error(result.text);
      }
    });
    return execution;
  },
};
