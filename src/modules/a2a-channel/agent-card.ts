import type { IncomingMessage } from "node:http";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  A2A_EXTENDED_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  type JsonObject,
} from "./protocol.js";

export type A2AAgentCard = {
  name: string;
  description: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: "JSONRPC";
    protocolVersion: string;
    tenant?: string;
  }>;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  };
  securitySchemes: {
    bearer: {
      httpAuthSecurityScheme: {
        scheme: "Bearer";
        description: string;
      };
    };
  };
  securityRequirements: Array<{ bearer: string[] }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  metadata: JsonObject;
};

export type A2AAgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
};

export function buildAgentCard(ctx: ModuleContext, req: IncomingMessage, extended: boolean): A2AAgentCard {
  const origin = requestOrigin(req);
  const tenant = extended ? selectedProjectTenant(req) : null;
  const moduleSkills = ctx
    .getModuleSummaries()
    .flatMap((summary) => summary.skillNames)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 6);
  return {
    name: "KOTA",
    description: "KOTA daemon sessions exposed as an Agent2Agent-compatible agent peer.",
    supportedInterfaces: [
      {
        url: `${origin}${A2A_RPC_PATH}`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        ...(tenant ? { tenant } : {}),
      },
    ],
    version: "0.1.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      bearer: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description: "Use the configured KOTA daemon or serve bearer token.",
        },
      },
    },
    securityRequirements: [{ bearer: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "kota.session",
        name: "KOTA Session",
        description: "Start, continue, stream, inspect, and cancel daemon-owned KOTA sessions.",
        tags: ["coding", "automation", "sessions"],
        examples: ["Ask KOTA to implement a scoped repository task."],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
      {
        id: "kota.queue",
        name: "KOTA Task Queue",
        description: "Work against the normalized repository task queue through KOTA sessions.",
        tags: ["tasks", "repository"],
        examples: ["Ask KOTA to pick up a dependency-clear task."],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
    metadata: {
      extendedCardUrl: `${origin}${A2A_EXTENDED_CARD_PATH}`,
      mcpComplementary: true,
      pushNotificationsImplemented: false,
      ...(extended ? { moduleSkills } : {}),
    },
  };
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto ?? "http";
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost ?? firstHeaderValue(req.headers.host) ?? "127.0.0.1";
  return `${proto}://${host}`;
}

function selectedProjectTenant(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  return projectId.length > 0 ? projectId : null;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
