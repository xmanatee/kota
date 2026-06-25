import type { KotaJsonObject, KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
  RESOURCE_DISCOVERY_KINDS,
  type ResourceDiscoveryKind,
  type ResourceDiscoveryProvider,
  type ResourceDiscoveryResult,
} from "./client.js";
import { renderResourceDiscoveryResultPlain } from "./render.js";

export const resourceDiscoveryTool: KotaTool = {
  name: "resource_discovery",
  description:
    "Find and rank KOTA tools, skills, agents, workflows, modules, channels, MCP config entries, setup requirements, knowledge entries, and recall hits for a task. Read-only and advisory; it does not run tools, connect MCP servers, or satisfy setup.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language task or resource requirement.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of ranked resources to return.",
      },
      kinds: {
        type: "array",
        items: { type: "string", enum: [...RESOURCE_DISCOVERY_KINDS] },
        description: "Optional subset of resource kinds to include.",
      },
      includeUnavailable: {
        type: "boolean",
        description: "When false, omit unavailable resources from results.",
      },
    },
    required: ["query"],
  },
};

function jsonObject(value: ResourceDiscoveryResult): KotaJsonObject {
  return JSON.parse(JSON.stringify(value));
}

function parseKinds(value: readonly string[]): ResourceDiscoveryKind[] | null {
  const kinds: ResourceDiscoveryKind[] = [];
  for (const item of value) {
    if (!RESOURCE_DISCOVERY_KINDS.includes(item as ResourceDiscoveryKind)) {
      return null;
    }
    kinds.push(item as ResourceDiscoveryKind);
  }
  return kinds;
}

export function createResourceDiscoveryToolRunner(
  resolveProvider: () => ResourceDiscoveryProvider,
): ToolDef["runner"] {
  return async (input): Promise<ToolResult> => {
    if (typeof input.query !== "string" || input.query.trim() === "") {
      return {
        content: "Resource discovery failed: `query` must be a non-empty string.",
        is_error: true,
      };
    }
    const filter: {
      limit?: number;
      kinds?: ResourceDiscoveryKind[];
      includeUnavailable?: boolean;
    } = {};
    if (input.limit !== undefined) {
      if (
        typeof input.limit !== "number" ||
        !Number.isInteger(input.limit) ||
        input.limit < 1
      ) {
        return {
          content: "Resource discovery failed: `limit` must be a positive integer when supplied.",
          is_error: true,
        };
      }
      filter.limit = input.limit;
    }
    if (input.includeUnavailable !== undefined) {
      if (typeof input.includeUnavailable !== "boolean") {
        return {
          content: "Resource discovery failed: `includeUnavailable` must be boolean when supplied.",
          is_error: true,
        };
      }
      filter.includeUnavailable = input.includeUnavailable;
    }
    if (input.kinds !== undefined) {
      if (
        !Array.isArray(input.kinds) ||
        !input.kinds.every((item) => typeof item === "string")
      ) {
        return {
          content: "Resource discovery failed: `kinds` must be an array when supplied.",
          is_error: true,
        };
      }
      const kinds = parseKinds(input.kinds);
      if (!kinds) {
        return {
          content: `Resource discovery failed: \`kinds\` must contain ${RESOURCE_DISCOVERY_KINDS.join(", ")}.`,
          is_error: true,
        };
      }
      filter.kinds = kinds;
    }
    const result = await resolveProvider().discover(input.query, filter);
    return {
      content: renderResourceDiscoveryResultPlain(result),
      structuredContent: jsonObject(result),
      ...(result.ok ? {} : { is_error: true }),
    };
  };
}

export function createResourceDiscoveryToolDef(
  resolveProvider: () => ResourceDiscoveryProvider,
): ToolDef {
  return {
    tool: resourceDiscoveryTool,
    runner: createResourceDiscoveryToolRunner(resolveProvider),
    effect: readOnlyDaemonEffect(),
  };
}
