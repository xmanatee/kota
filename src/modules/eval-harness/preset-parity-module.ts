import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaModule } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { AUTONOMY_AGENT_TIER } from "#modules/autonomy/shared.js";
import { createModelClientImpl } from "#modules/model-clients/factory.js";
import { paritySurfaceSchema } from "./preset-parity-evidence.js";
import { installParityObserver } from "./preset-parity-observer.js";

/** Installed in a disposable scope by the live gate; never contributed by the
 * shipped eval module. The harness probes run through the daemon's ordinary workflow
 * admission, agent lookup, validation, execution, and persisted run store.
 * The autonomy probe consumes the shipped builder AgentDef with a read-only
 * fixture task, so no generated executable or verifier acquires host authority.
 */
export function createPresetParityModule(): KotaModule {
  let observer: ReturnType<typeof installParityObserver> | undefined;
  const observation = () => {
    if (!observer) throw new Error("Parity observer did not load");
    return observer;
  };
  const workflows: WorkflowDefinitionInput[] = ["single-turn", "tool-turn", "workflow", "autonomy"].map((surface) => ({
    name: `preset-parity-${surface}`,
    repository: "read",
    defaultAutonomyMode: "autonomous",
    triggers: [{ event: "manual" }],
    steps: [
      {
        id: "start", type: "code",
        run(ctx) {
          const start = {
            runId: ctx.workflow.runId, workflow: ctx.workflow.name,
            presetId: ctx.agentRuntime.preset.id, harness: ctx.agentRuntime.harness,
          };
          observation().evidence.starts.push(start);
          return start;
        },
      },
      {
        id: "agent", type: "agent",
        ...(surface === "autonomy" ? { agentName: "builder" } : {}),
        promptPath: `parity-${surface}.md`,
        tier: surface === "autonomy" ? AUTONOMY_AGENT_TIER : "balanced",
        effort: "medium",
        timeoutMs: 180_000,
        retry: { maxAttempts: 2, initialDelayMs: 1000, backoffFactor: 1 },
      },
      {
        id: "record", type: "code",
        run(ctx) {
          // Preserve actual step results, including the executor's model field.
          // The parent retrieves this before removing the disposable scope.
          writeFileSync(join(ctx.scopeRoot, `parity-${surface}-run.json`), JSON.stringify({
            runId: ctx.workflow.runId,
            start: ctx.stepResults.start,
            agent: ctx.stepResults.agent,
          }));
          return "recorded";
        },
      },
    ],
  }));
  return {
    name: "preset-parity-probe", version: "1.0.0",
    description: "Disposable daemon parity observation and workflow stimuli",
    dependencies: ["autonomy", "model-clients", "claude-agent-harness", "codex-agent-harness", "gemini-agent-harness"],
    workflows,
    onLoad(ctx) {
      if (ctx.config.failover) throw new Error("Parity fixture must not configure provider failover");
      observer = installParityObserver(ctx.cwd, createModelClientImpl);
      return { dispose: () => observation().dispose() };
    },
    controlRoutes: () => [
      { method: "GET", path: "/preset-parity/evidence", capabilityScope: "read",
        handler: async (_req, res) => { jsonResponse(res, 200, observation().evidence); } },
      { method: "POST", path: "/preset-parity/surface", capabilityScope: "control",
        handler: async (req, res) => {
          const body = await readBody(req);
          const parsed = paritySurfaceSchema.safeParse(body.surface);
          if (!parsed.success) { jsonResponse(res, 400, { error: "Invalid parity surface" }); return; }
          observation().setSurface(parsed.data);
          jsonResponse(res, 200, { ok: true });
        } },
    ],
  };
}
