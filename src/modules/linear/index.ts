import type { KotaModule, ModuleContext, ModuleRuntimeContext, ToolDef } from "#core/modules/module-types.js";
import { TASK_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import { OUTBOUND_HTTP_PROFILES, outboundHttp } from "#core/outbound-http/index.js";
import { makeLinearTools, resolveTeamContext } from "./linear-tools.js";
import type { LinearTaskProviderConfig } from "./task-provider.js";
import { LinearTaskProvider } from "./task-provider.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type LinearConfig = {
  apiKey: string;
  taskProvider?: LinearTaskProviderConfig;
  teamKey?: string;
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
  const { response: res } = await outboundHttp.request({
    profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://api.linear.app"]),
    operation: "linear.graphql",
    url: "https://api.linear.app/graphql",
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
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "linear.issues",
        description: "Read and update Linear issues through the configured team GraphQL API.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "owner-confirmation"],
      },
      {
        id: "linear.task-provider",
        description: "Synchronize KOTA task provider state from a configured Linear team.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "retention"],
      },
    ],
    dataClasses: [
      {
        id: "linear.credentials",
        description: "Linear API key references resolved from scope config or environment variables.",
        sensitivity: "credential",
        retention: "scope-durable",
        redaction: "mask-secret",
      },
      {
        id: "linear.issue-content",
        description: "Linear issue titles, descriptions, labels, states, and comments returned by GraphQL.",
        sensitivity: "provider-payload",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Linear issue writes mutate external project-management state and are blocked in workflow trial mode.",
      ],
    },
  },

  tools(ctx: ModuleContext): ToolDef[] {
    const config = ctx.getModuleConfig<LinearConfig>();
    if (!config?.apiKey) return [];

    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) return [];

    const teamKey = config.taskProvider?.teamKey ?? config.teamKey;
    if (!teamKey) {
      ctx.log.warn("Linear module: no teamKey configured — tools inactive");
      return [];
    }

    const boundFetch = (query: string, variables?: Record<string, unknown>) =>
      linearFetch(apiKey, query, variables);

    let cached: ReturnType<typeof resolveTeamContext> | null = null;
    const getTeamContext = () => {
      if (!cached) cached = resolveTeamContext(boundFetch, teamKey);
      return cached;
    };

    return makeLinearTools(boundFetch, getTeamContext);
  },

  async onLoad(ctx: ModuleRuntimeContext): Promise<void> {
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
      ctx.registerProvider(TASK_PROVIDER_TOKEN, {
        collection: provider.collection,
        mutations: provider,
      });
      ctx.log.info("Linear Issues task provider registered");
    } catch (err) {
      ctx.log.warn(
        `Linear task provider: init failed — ${(err as Error).message}`,
      );
    }
  },
};

export default linearModule;
