/**
 * Linear module — TaskProvider backed by Linear Issues.
 *
 * When `modules.linear.taskProvider.enabled` is true, this module registers
 * a LinearTaskProvider so KOTA's builder can pull tasks directly from a Linear
 * team's backlog without maintaining a parallel file queue.
 *
 * Config (under modules.linear):
 *   apiKey:        Linear API key or "$ENV_VAR" reference. Required.
 *   taskProvider:
 *     enabled:         Must be true to activate. Default: false.
 *     teamKey:         Linear team key (e.g. "ENG"). Required.
 *     labelFilter:     Only include issues with this label. Default: no filter.
 *     inProgressState: Workflow state name for "in progress". Default: "In Progress".
 *     doneState:       Workflow state name for "done". Default: "Done".
 *
 * Uses Linear's GraphQL API; no npm dependencies.
 * API key is never logged.
 */

import type { KotaModule, ModuleContext } from "../../module-types.js";
import type { LinearTaskProviderConfig } from "./task-provider.js";
import { LinearTaskProvider } from "./task-provider.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type LinearConfig = {
  /** Linear API key or "$ENV_VAR" reference. Required. */
  apiKey: string;
  /** Optional Linear Issues task provider configuration. */
  taskProvider?: LinearTaskProviderConfig;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveApiKey(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

async function linearFetch(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data: Record<string, unknown>; errors?: Array<{ message: string }> };
  return json;
}

// ─── Module ──────────────────────────────────────────────────────────────────

const linearModule: KotaModule = {
  name: "linear",
  tools: [],

  async onLoad(ctx: ModuleContext): Promise<void> {
    const config = ctx.getModuleConfig<LinearConfig>();
    if (!config?.taskProvider?.enabled) return;

    if (!config.apiKey) {
      ctx.log.warn(
        "Linear task provider: modules.linear.apiKey is required but missing — provider inactive",
      );
      return;
    }

    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) {
      ctx.log.warn(
        `Linear task provider: API key env var "${config.apiKey}" is not set — provider inactive`,
      );
      return;
    }

    if (!config.taskProvider.teamKey) {
      ctx.log.warn(
        "Linear task provider: modules.linear.taskProvider.teamKey is required — provider inactive",
      );
      return;
    }

    const boundFetch = (query: string, variables?: Record<string, unknown>) =>
      linearFetch(apiKey, query, variables);

    const provider = new LinearTaskProvider(config.taskProvider, boundFetch);
    try {
      await provider.init();
      ctx.registerProvider("task", provider);
      ctx.log.info("Linear Issues task provider registered");
    } catch (err) {
      ctx.log.warn(
        `Linear task provider: init failed — ${(err as Error).message}`,
      );
    }
  },
};

export default linearModule;
