import type {
  ResourceDiscoveryHit,
  ResourceDiscoveryReadiness,
  ResourceDiscoveryResult,
} from "./client.js";

function readinessLabel(readiness: ResourceDiscoveryReadiness): string {
  switch (readiness.status) {
    case "ready":
    case "read_only":
    case "unavailable":
      return `${readiness.status}: ${readiness.message}`;
    case "setup_blocked":
      return `${readiness.status}: ${readiness.blockers.map((blocker) =>
        `${blocker.moduleName}/${blocker.requirementId}=${blocker.state}`
      ).join(", ")}`;
  }
}

function riskLabel(hit: ResourceDiscoveryHit): string {
  if (!hit.risk) return "none";
  return `${hit.risk.risk} ${hit.risk.effect.kind}/${hit.risk.effect.scope}`;
}

function compactDescription(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

export function renderResourceDiscoveryHitsPlain(
  hits: readonly ResourceDiscoveryHit[],
): string {
  if (hits.length === 0) return "No matching resources.";
  return hits.map((hit, index) => [
    `${index + 1}. ${hit.kind}  ${hit.score.toFixed(3)}  ${hit.ownerModule}  ${hit.name}`,
    `   ${compactDescription(hit.description)}`,
    `   readiness: ${readinessLabel(hit.readiness)}`,
    `   risk: ${riskLabel(hit)}`,
    `   inspect: ${hit.inspectPath}`,
    `   access: ${hit.accessHint}`,
    hit.why.length > 0 ? `   why: ${hit.why.join("; ")}` : "",
  ].filter(Boolean).join("\n")).join("\n");
}

export function renderResourceDiscoveryResultPlain(
  result: ResourceDiscoveryResult,
): string {
  if (!result.ok) return result.message;
  return renderResourceDiscoveryHitsPlain(result.hits);
}
