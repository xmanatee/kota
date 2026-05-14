/**
 * Neutral entry point for every `AgentHarness.run()` invocation.
 *
 * `runAgentHarness` dispatches harness-boundary hooks around the adapter's
 * native run, so preRun/postRun hooks registered via `registerHarnessHook`
 * fire consistently regardless of which adapter was selected. Callers that
 * need a harness should go through this function instead of invoking
 * `harness.run()` directly — only the adapter implementations themselves
 * (and the tests that cover them in isolation) touch `run()` without the
 * wrapper.
 */

import {
  type HarnessHookKind,
  hasHarnessHooks,
  listHarnessHooks,
} from "./hooks.js";
import type {
  AgentHarnessUnsupportedOption,
  AgentHarnessUnsupportedRunOption,
} from "./readiness.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "./types.js";

function assertAdapterHonorsRegisteredHooks(harness: AgentHarness): void {
  const supported = new Set(harness.supportedHookKinds);
  const kinds: HarnessHookKind[] = ["preRun", "postRun"];
  for (const kind of kinds) {
    if (hasHarnessHooks(kind) && !supported.has(kind)) {
      throw new Error(
        `Agent harness "${harness.name}" does not host the "${kind}" hook, ` +
          "but a module registered one. Remove the hook, migrate it to a " +
          "classic-loop hook, or run a harness that declares support.",
      );
    }
  }
}

function assertAdapterCanHostRequestedCapabilities(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): void {
  const unsupported = requestedUnsupportedOptions(harness, options);
  if (unsupported.length > 0) {
    const labels = unsupported.map((entry) => entry.option).join(", ");
    const reasons = unsupported.map((entry) => `${entry.option}: ${entry.reason}`).join("; ");
    throw new Error(
      `Agent harness "${harness.name}" cannot honor requested run option(s): ${labels}. ` +
        `${reasons}`,
    );
  }
  if (options.askOwner && harness.askOwnerToolName === null) {
    throw new Error(
      `Agent harness "${harness.name}" cannot host the owner-questions surface (askOwnerToolName is null). ` +
        "Drop askOwner or run a harness that declares support — never run owner-questions silently disabled.",
    );
  }
}

function requestedUnsupportedOptions(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): AgentHarnessUnsupportedOption[] {
  return (harness.unsupportedRunOptions ?? []).filter((entry) =>
    entry.runOption !== undefined && isRunOptionRequested(entry.runOption, options)
  );
}

function isRunOptionRequested(
  option: AgentHarnessUnsupportedRunOption,
  options: AgentHarnessRunOptions,
): boolean {
  if (option === "mcpServers") {
    return options.mcpServers !== undefined && Object.keys(options.mcpServers).length > 0;
  }
  if (option === "allowedTools") {
    return options.allowedTools !== undefined && options.allowedTools.length > 0;
  }
  if (option === "disallowedTools") {
    return options.disallowedTools !== undefined && options.disallowedTools.length > 0;
  }
  if (option === "canUseTool") return options.canUseTool !== undefined;
  if (option === "askOwner") return options.askOwner !== undefined;
  if (option === "autonomyMode.supervised") return options.autonomyMode === "supervised";
  if (option === "persistSession") return options.persistSession === true;
  if (option === "harnessOverrides") return options.harnessOverrides !== undefined;
  if (option === "enableFileCheckpointing") return options.enableFileCheckpointing === true;
  if (option === "thinking") {
    return options.thinkingEnabled === true || options.thinkingBudget !== undefined;
  }
  return options.onMessage !== undefined;
}

export async function runAgentHarness(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  assertAdapterHonorsRegisteredHooks(harness);
  assertAdapterCanHostRequestedCapabilities(harness, options);

  for (const hook of listHarnessHooks("preRun")) {
    await hook.handler({ harness, options });
  }

  const result = await harness.run(options, writer);

  for (const hook of listHarnessHooks("postRun")) {
    await hook.handler({ harness, options, result });
  }

  return result;
}
