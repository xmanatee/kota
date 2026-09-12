import type { Command } from "commander";
import { type KotaAgentMessage, resolveAgentHarness, runAgentHarness } from "#core/agent-harness/index.js";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import { withProcessSignalAbort } from "#core/util/process-signal-abort.js";
import { writeStdout } from "#modules/rendering/transport.js";
import { CONTAINED_STAGE_RESULT_PREFIX, containedStageRequest } from "./contained-stage-protocol.js";

/** Image-local agent entrypoint. Host authority never comes from this request. */
export function registerContainedStageCommand(command: Command): void {
  command.command("contained-stage", { hidden: true }).argument("<request>")
    .action(async (raw: string) => {
      const { harness: name, harnessOverrides, ...request } = containedStageRequest.parse(JSON.parse(raw));
      const harness = resolveAgentHarness(name);
      const messages: KotaAgentMessage[] = [];
      const overrides = harnessOverrides === undefined ? undefined : harness.validateStepOptions?.(harnessOverrides);
      if (harnessOverrides !== undefined && overrides === undefined) throw new Error("Harness rejected contained stage options");
      const result = await withProcessSignalAbort((abortController) => runAgentHarness(harness, {
        ...request, harnessOverrides: overrides, cwd: process.cwd(), scopeRoot: resolveScopeRoot(), abortController,
        ...(harness.emitsAgentMessageStream ? { onMessage: (message: KotaAgentMessage) => { messages.push(message); } } : {}),
      }, { write: () => true }));
      writeStdout(`${CONTAINED_STAGE_RESULT_PREFIX}${JSON.stringify({ result, messages })}\n`);
    });
}
