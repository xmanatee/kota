import { createHash } from "node:crypto";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { McpToolSchema } from "./client-protocol.js";

export type McpToolDeclarationFacet =
  | "serverIdentity"
  | "description"
  | "inputSchema"
  | "outputSchema"
  | "annotations"
  | "capabilities";

export type McpToolDeclarationFingerprint = {
  fingerprint: string;
  facetFingerprints: Record<McpToolDeclarationFacet, string>;
};

const FINGERPRINT_VERSION = "mcp-tool-declaration-v1";
export const MCP_TOOL_DECLARATION_FACETS: readonly McpToolDeclarationFacet[] = [
  "serverIdentity",
  "description",
  "inputSchema",
  "outputSchema",
  "annotations",
  "capabilities",
];

export type FingerprintMcpToolDeclarationArgs = {
  serverConfigName: string;
  serverDisplayName: string;
  tool: McpToolSchema;
  tasksSupported: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringifyJson(value: KotaJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function clonedJson(value: object): KotaJsonValue {
  return JSON.parse(JSON.stringify(value)) as KotaJsonValue;
}

function optionalJsonObject(value: object | undefined): KotaJsonValue {
  return value === undefined
    ? { state: "missing" }
    : { state: "present", value: clonedJson(value) };
}

function toolDeclarationFacetValues(
  args: FingerprintMcpToolDeclarationArgs,
): Record<McpToolDeclarationFacet, KotaJsonValue> {
  return {
    serverIdentity: {
      serverConfigName: args.serverConfigName,
      serverDisplayName: args.serverDisplayName,
      originalToolName: args.tool.name,
    },
    description: args.tool.description === undefined
      ? { state: "missing" }
      : { state: "present", value: args.tool.description },
    inputSchema: clonedJson(args.tool.inputSchema),
    outputSchema: optionalJsonObject(args.tool.outputSchema),
    annotations: optionalJsonObject(args.tool.annotations),
    capabilities: { tasksSupported: args.tasksSupported },
  };
}

export function fingerprintMcpToolDeclaration(
  args: FingerprintMcpToolDeclarationArgs,
): McpToolDeclarationFingerprint {
  const facets = toolDeclarationFacetValues(args);
  const facetFingerprints = Object.fromEntries(
    MCP_TOOL_DECLARATION_FACETS.map((facet) => [
      facet,
      sha256(stableStringifyJson(facets[facet])),
    ]),
  ) as Record<McpToolDeclarationFacet, string>;
  const material: KotaJsonValue = {
    version: FINGERPRINT_VERSION,
    facets,
  };
  return {
    fingerprint: sha256(stableStringifyJson(material)),
    facetFingerprints,
  };
}

export function changedMcpToolDeclarationFacets(
  previous: McpToolDeclarationFingerprint,
  current: McpToolDeclarationFingerprint,
): McpToolDeclarationFacet[] {
  return MCP_TOOL_DECLARATION_FACETS.filter(
    (facet) => previous.facetFingerprints[facet] !== current.facetFingerprints[facet],
  );
}
