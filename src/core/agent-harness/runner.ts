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

export async function runAgentHarness(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  assertAdapterHonorsRegisteredHooks(harness);

  for (const hook of listHarnessHooks("preRun")) {
    await hook.handler({ harness, options });
  }

  const result = await harness.run(options, writer);

  for (const hook of listHarnessHooks("postRun")) {
    await hook.handler({ harness, options, result });
  }

  return result;
}
