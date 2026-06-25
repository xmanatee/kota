import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import {
  networkWriteEffect,
  operatorSurfaceEffect,
  type ToolEffect,
} from "#core/tools/effect.js";
import type { ResourceDiscoverySnapshot } from "./catalog.js";

const slackEffect = networkWriteEffect();
const slackChannelEffect = operatorSurfaceEffect();

const slackTool: KotaTool = {
  name: "slack_send",
  description: "Send a Slack approval prompt to an operator channel.",
  input_schema: { type: "object", properties: {} },
};

function statusLinks(moduleName: string, requirementId: string) {
  const base = `/setup/requirements/${moduleName}/${requirementId}`;
  return {
    list: "/setup/requirements",
    refresh: `${base}/refresh`,
    revoke: base,
    storeSecret: `${base}/secret`,
    start: `${base}/start`,
  };
}

function slackManifest(effect: ToolEffect): ModuleCapabilityManifestProjection {
  return {
    schemaVersion: 1,
    moduleName: "slack-channel",
    dependencies: [],
    capabilities: [
      {
        id: "slack-channel.approvals",
        description: "Post approval prompts and operator notifications into Slack.",
        scope: "external",
        scopePolicyHooks: ["setup", "external-effects", "owner-confirmation"],
        setupRequirementIds: ["socket-mode-credentials"],
      },
    ],
    dataClasses: [],
    contributions: {
      tools: ["slack_send"],
      workflows: [],
      workflowTriggers: [],
      channels: ["slack-channel"],
      skills: [],
      agents: [],
      commands: [],
      routes: [],
      controlRoutes: [],
      events: [],
      eventFlows: [],
      clients: { localNamespaces: [], daemonFactory: false },
      setupRequirements: [
        {
          id: "socket-mode-credentials",
          kind: "secret",
          setupMode: "url",
          sensitivity: "secret",
          required: true,
          healthCapabilityIds: [],
          statusLinks: statusLinks("slack-channel", "socket-mode-credentials"),
          availability: {
            state: "missing",
            reason: "secret_missing",
            message: "Slack bot and app token secret references are missing.",
          },
        },
      ],
    },
    effects: [
      {
        id: "tool.slack_send",
        description: slackTool.description,
        source: "tool",
        target: "slack_send",
        effect,
        risk: "moderate",
        categories: ["external-write"],
        capabilityIds: ["slack-channel.approvals"],
        simulation: {
          blocked: true,
          reason: "external write blocked in trial mode",
        },
      },
      {
        id: "slack-channel.message-delivery",
        description: "Deliver command replies, approval prompts, and notifications to Slack.",
        source: "channel",
        target: "slack-channel.message-delivery",
        effect: slackChannelEffect,
        risk: "safe",
        categories: ["notification", "owner-visible"],
        capabilityIds: ["slack-channel.approvals"],
        simulation: {
          blocked: true,
          reason: "external operator-visible delivery blocked in trial mode",
        },
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: ["external write blocked in trial mode"],
    },
    readiness: {
      setupRequirementIds: ["socket-mode-credentials"],
      healthCapabilityIds: [],
      healthCheck: "not-declared",
    },
  };
}

export function notificationManifest(): ModuleCapabilityManifestProjection {
  const effect = operatorSurfaceEffect();
  return {
    schemaVersion: 1,
    moduleName: "slack",
    dependencies: ["notification"],
    capabilities: [
      {
        id: "slack.notifications",
        description:
          "Send KOTA workflow, approval, and owner-question notifications through a Slack Incoming Webhook.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "owner-confirmation", "setup"],
      },
    ],
    dataClasses: [],
    contributions: {
      tools: [],
      workflows: [],
      workflowTriggers: [],
      channels: [],
      skills: [],
      agents: [],
      commands: [],
      routes: [],
      controlRoutes: [],
      events: [],
      eventFlows: [],
      clients: { localNamespaces: [], daemonFactory: false },
      setupRequirements: [],
    },
    effects: [
      {
        id: "slack.webhook-delivery",
        description: "Deliver workflow, approval, and owner-question notifications to Slack.",
        source: "notification",
        target: "slack.webhook-delivery",
        effect,
        risk: "safe",
        categories: ["notification", "owner-visible"],
        capabilityIds: ["slack.notifications"],
        simulation: {
          blocked: true,
          reason: "operator-visible notification delivery blocked in trial mode",
        },
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: ["operator-visible notification delivery blocked in trial mode"],
    },
    readiness: {
      setupRequirementIds: [],
      healthCapabilityIds: [],
      healthCheck: "not-declared",
    },
  };
}

export function moduleSummary(
  overrides: Partial<ModuleSummary> = {},
): ModuleSummary {
  return {
    name: "slack-channel",
    source: "project",
    version: "1.0.0",
    description: "Bidirectional Slack bot channel for KOTA.",
    dependencies: [],
    toolNames: ["slack_send"],
    workflowNames: [],
    channelNames: ["slack-channel"],
    skillNames: [],
    agentNames: [],
    agents: [],
    skills: [],
    commandNames: [],
    routeSummaries: [],
    manifest: slackManifest(slackEffect),
    ...overrides,
  };
}

function knowledgeEntry(): KnowledgeEntry {
  return {
    id: "k-ard",
    title: "Agentic Resource Discovery",
    type: "research",
    tags: ["resources", "agents"],
    status: "active",
    created: "2026-06-24T00:00:00.000Z",
    updated: "2026-06-24T00:00:00.000Z",
    content: "Agents need to identify, locate, evaluate, and access resources.",
    meta: {},
  };
}

export function snapshot(
  overrides: Partial<ResourceDiscoverySnapshot> = {},
): ResourceDiscoverySnapshot {
  return {
    summaries: [moduleSummary()],
    tools: [slackTool],
    toolEffects: new Map([["slack_send", slackEffect]]),
    skillSummaries: [],
    knowledgeEntries: [knowledgeEntry()],
    recallHits: [],
    mcpServers: [],
    ...overrides,
  };
}
