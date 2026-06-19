import type { KotaModule } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import {
  buildChannelOpportunityReferenceWorkflow,
  type ChannelOpportunityReferenceWorkflowOptions,
} from "./workflow.js";

export type ChannelOpportunityReferenceConfig = {
  calendarToolName?: string;
  providerActionAdapterName?: string;
  failProviderActionIds?: readonly string[];
};

const setupRequirements: ModuleSetupRequirement[] = [
  {
    id: "calendar-provider",
    kind: "config",
    title: "Calendar availability provider",
    description:
      "Configured calendar tool used by the reference workflow to read busy windows before owner escalation.",
    required: false,
    scope: "project",
    owner: "channel-opportunity-reference",
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [
        {
          id: "calendar-tool-name",
          label: "Calendar tool name",
          type: "string",
          configPath: "modules.channel-opportunity-reference.calendarToolName",
          required: false,
          placeholder: "calendar_list_events",
          helperText:
            "Tool output should be JSON with busyWindows or events containing start, end, and summary.",
        },
      ],
    },
  },
  {
    id: "provider-action-adapter",
    kind: "config",
    title: "Provider action adapter",
    description:
      "Module-owned adapter name recorded in owner-confirmed action metadata for dry-run booking or reaction dispatch.",
    required: false,
    scope: "project",
    owner: "channel-opportunity-reference",
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [
        {
          id: "provider-action-adapter-name",
          label: "Adapter name",
          type: "string",
          configPath:
            "modules.channel-opportunity-reference.providerActionAdapterName",
          required: false,
          placeholder: "channel-opportunity-reference",
        },
      ],
    },
  },
];

function workflowOptions(config: ChannelOpportunityReferenceConfig | undefined): ChannelOpportunityReferenceWorkflowOptions {
  return {
    ...(config?.calendarToolName !== undefined
      ? { calendarToolName: config.calendarToolName }
      : {}),
    ...(config?.providerActionAdapterName !== undefined
      ? { providerActionAdapterName: config.providerActionAdapterName }
      : {}),
    ...(config?.failProviderActionIds !== undefined
      ? { failProviderActionIds: config.failProviderActionIds }
      : {}),
  };
}

const channelOpportunityReferenceModule: KotaModule = {
  name: "channel-opportunity-reference",
  version: "1.0.0",
  description:
    "Reference workflow proving inbound channel batching, calendar availability, owner decisions, and dry-run provider actions compose.",
  dependencies: ["inbound-signals"],
  setupRequirements,
  workflows: (ctx) => [
    buildChannelOpportunityReferenceWorkflow(
      workflowOptions(ctx.getModuleConfig<ChannelOpportunityReferenceConfig>()),
    ),
  ],
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      calendarToolName: { type: "string", minLength: 1 },
      providerActionAdapterName: { type: "string", minLength: 1 },
      failProviderActionIds: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
    },
  },
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "channel-opportunity-reference.matching",
        description:
          "Batch, classify, calendar-check, and escalate community-channel opportunities as a reference workflow.",
        scope: "project",
        scopePolicyHooks: ["owner-confirmation", "setup", "external-effects"],
        setupRequirementIds: ["calendar-provider", "provider-action-adapter"],
      },
    ],
    dataClasses: [
      {
        id: "channel-opportunity-reference.channel-content",
        description:
          "Redacted channel messages, availability windows, owner-decision evidence, and dry-run provider action payloads.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "local-isolated",
      blockedReasons: [
        "Provider action execution is a dry-run reference adapter; production booking or channel writes belong to provider modules.",
      ],
    },
  },
};

export * from "./fixtures.js";
export * from "./matching.js";
export type { ChannelOpportunityRunArtifact } from "./workflow.js";
export { buildChannelOpportunityReferenceWorkflow };
export default channelOpportunityReferenceModule;
