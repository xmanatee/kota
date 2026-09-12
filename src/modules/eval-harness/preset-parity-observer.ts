import type { KotaMessageStream } from "#core/agent-harness/message-protocol.js";
import { listAgentHarnessNames, registerAgentHarness, resolveAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import { loadConfig } from "#core/config/config.js";
import { type ModelClientFactoryFn, registerModelClientFactory } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { ParityCall, ParityEvidence, ParitySurface } from "./preset-parity-evidence.js";

/** Pass-through observation used only by the explicitly installed parity fixture.
 * No prompts, credentials, tool inputs, or reasoning traces enter this projection.
 * In particular, an absent permission callback stays absent.
 */
export function observeParityHarness(
  harness: AgentHarness,
  begin: (model: string | undefined, harness: string, runId?: string) => ParityCall,
): AgentHarness {
  return {
    ...harness,
    async run(options, writer) {
      const call = begin(options.model, harness.name, options.workflowContext?.runId);
      const canUseTool = options.canUseTool;
      try {
        const result = await harness.run({
          ...options,
          ...(canUseTool ? { canUseTool: async (...args) => {
            call.tools.push(args[0]);
            return canUseTool(...args);
          } } : {}),
        }, writer);
        Object.assign(call, {
          status: result.isError ? "error" : "success",
          turns: result.turns,
          text: result.text,
        });
        return result;
      } catch (error) {
        call.status = "error";
        call.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
}

export function installParityObserver(scopeRoot: string, factory: ModelClientFactoryFn) {
  let surface: ParitySurface = "boot";
  const activePresetId = () => resolveActivePresetFromConfig(loadConfig(scopeRoot)).id;
  const evidence: ParityEvidence = { presetId: activePresetId(), calls: [], starts: [] };
  function begin(model: string | undefined, boundary: ParityCall["boundary"], harness?: string, runId?: string): ParityCall {
    const call: ParityCall = {
      id: evidence.calls.length, surface, presetId: activePresetId(),
      boundary, model: model ?? null, requestedModel: model ?? null, harness, runId, tools: [], status: "started",
    };
    evidence.calls.push(call);
    return call;
  }
  const dispose = listAgentHarnessNames().map((name) => registerAgentHarness(
    observeParityHarness(resolveAgentHarness(name), (model, harness, runId) => begin(model, "harness", harness, runId)),
  ));
  registerModelClientFactory((options) => {
    // Capture factory failures too: capture can otherwise hide missing auth by
    // retaining a note in the inbox and returning a superficially successful result.
    let resolved: ReturnType<ModelClientFactoryFn>;
    try { resolved = factory(options); } catch (error) {
      const call = begin(options.model, "model-client");
      call.status = "error";
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return { ...resolved, client: { messages: {
      stream(params) {
        const call = begin(params.model, "model-client");
        call.requestedModel = options.model;
        try {
          const stream = resolved.client.messages.stream(params);
          const observed: KotaMessageStream = {
            on(event, callback) {
              if (event === "text") stream.on("text", callback);
              else stream.on("thinking", callback);
              return observed;
            },
            async finalMessage() {
              try { const result = await stream.finalMessage(); call.status = "success"; return result; }
              catch (error) { call.status = "error"; call.error = error instanceof Error ? error.message : String(error); throw error; }
            },
          };
          return observed;
        } catch (error) { call.status = "error"; call.error = error instanceof Error ? error.message : String(error); throw error; }
      },
      async create(params) {
        const call = begin(params.model, "model-client");
        call.requestedModel = options.model;
        try {
          const result = await resolved.client.messages.create(params);
          call.status = "success";
          return result;
        } catch (error) {
          call.status = "error";
          call.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
    } } };
  });
  return {
    evidence,
    setSurface(next: ParitySurface) { surface = next; },
    dispose() { for (const stop of dispose.reverse()) stop(); registerModelClientFactory(factory); },
  };
}
