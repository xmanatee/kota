import type {
  AgentEffort,
  AgentHarnessAuthProbe,
  AgentHarnessModelEffortReadiness,
  AgentHarnessReadinessRequest,
} from "#core/agent-harness/index.js";

const AGY_MODEL_TOKEN = /\bgemini-[A-Za-z0-9][A-Za-z0-9._-]*/g;

export type AntigravityCliEffort = "low" | "medium" | "high";

export function resolveAntigravityCliEffort(
  effort: AgentEffort,
): AntigravityCliEffort {
  return effort === "low" || effort === "medium" ? effort : "high";
}

export function parseAntigravityCliModelCatalog(output: string): string[] {
  return [...new Set(output.match(AGY_MODEL_TOKEN) ?? [])].sort();
}

export function resolveAntigravityCliCatalogModel(
  model: string,
  effort: AgentEffort,
): string {
  const suffix = `-${resolveAntigravityCliEffort(effort)}`;
  return model.endsWith(suffix) ? model : `${model}${suffix}`;
}

export function resolveAntigravityCliModelEffortReadiness(
  request: AgentHarnessReadinessRequest,
  auth: AgentHarnessAuthProbe,
): AgentHarnessModelEffortReadiness {
  const adapterModel = resolveAntigravityCliCatalogModel(
    request.model,
    request.effort,
  );
  const base = {
    kind: "model-effort" as const,
    required: true as const,
    model: request.model,
    effort: request.effort,
    adapterModel,
    command: "agy models",
  };
  if (auth.status !== "ready" && auth.status !== "expiring") {
    return {
      ...base,
      status: "error",
      detail: auth.detail,
      summary:
        `Cannot verify AGY model/effort ${adapterModel}: ${auth.summary}`,
    };
  }

  const availableModels = parseAntigravityCliModelCatalog(auth.detail);
  if (!availableModels.includes(adapterModel)) {
    return {
      ...base,
      status: "unavailable",
      detail:
        `Available AGY model/effort entries: ` +
        `${availableModels.join(", ") || "(none)"}.`,
      summary: `AGY model/effort ${adapterModel} is unavailable`,
    };
  }

  return {
    ...base,
    status: "ready",
    summary: `AGY model/effort ${adapterModel} is available`,
  };
}
