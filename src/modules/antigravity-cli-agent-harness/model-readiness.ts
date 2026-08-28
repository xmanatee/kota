import type {
  AgentEffort,
  AgentHarnessAuthProbe,
  AgentHarnessModelEffortReadiness,
  AgentHarnessReadinessRequest,
} from "#core/agent-harness/index.js";

const AGY_MODEL_TOKEN = /^[a-z0-9][a-z0-9._-]*-[a-z0-9._-]+$/;

export type AntigravityCliEffort = "low" | "medium" | "high";

export function resolveAntigravityCliEffort(
  effort: AgentEffort,
): AntigravityCliEffort {
  return effort === "low" || effort === "medium" ? effort : "high";
}

export function parseAntigravityCliModelCatalog(output: string): string[] {
  const models = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/, 1)[0] ?? "")
    .filter((token) => AGY_MODEL_TOKEN.test(token));
  return [...new Set(models)].sort();
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
  const effortQualifiedModel = resolveAntigravityCliCatalogModel(
    request.model,
    request.effort,
  );
  const availableModels = auth.status === "ready" || auth.status === "expiring"
    ? parseAntigravityCliModelCatalog(auth.detail)
    : [];
  const adapterModel = availableModels.includes(request.model)
    ? request.model
    : effortQualifiedModel;
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
    summary:
      `AGY model/effort ${adapterModel} is listed; execution quota is not exposed by AGY`,
  };
}
