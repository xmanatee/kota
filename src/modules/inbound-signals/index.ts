import { Command } from "commander";
import { modelProviderSelectionFromConfig } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import { runHandoffAgent } from "#core/tools/handoff-agent.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import { WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-event-dispatcher-provider.js";
import { buildInboundSignalsCommand } from "./cli.js";
import type {
  InboundSignalProjectSelection,
  InboundSignalsClient,
} from "./client.js";
import {
  inboundSignalReceived,
  inboundSignalRouted,
} from "./events.js";
import {
  inboundSignalRouteStatusControlRoutes,
  inboundSignalRouteStatusRoutes,
} from "./routes.js";
import {
  dispatchInboundSignalRoute,
  type InboundSignalAgentTriggerOptions,
  type InboundSignalAgentTriggerResult,
  type InboundSignalRouteConfig,
  type InboundSignalRouteTargetConfig,
  type InboundSignalRouteValidationContext,
  type InboundSignalRoutingConfig,
  type InboundSignalRoutingStatus,
  inboundSignalRoutingStatus,
} from "./routing.js";

export * from "./events.js";
export * from "./routing.js";

let unsubscribeInboundSignals: (() => void) | null = null;

function routingConfig(ctx: ModuleContext): InboundSignalRoutingConfig {
  return ctx.getModuleConfig<InboundSignalRoutingConfig>() ?? {};
}

function routingValidationContext(
  ctx: ModuleContext,
): InboundSignalRouteValidationContext {
  return {
    workflowNames: new Set(ctx.getContributedWorkflows().map((workflow) => workflow.name)),
    agentNames: new Set(ctx.getModuleSummaries().flatMap((summary) => summary.agentNames)),
  };
}

function progressReviewerTarget(
  workflowNames: ReadonlySet<string>,
): InboundSignalRouteConfig["targets"][number] | null {
  if (!workflowNames.has("progress-reviewer")) return null;
  return {
    kind: "workflow",
    name: "progress-reviewer",
    batch: {
      mode: "workflow-trigger",
      maxItems: 10,
      idleMs: 10 * 60 * 1000,
      maxBufferSize: 30,
      overflow: "flush-oldest",
      groupBy: ["channel", "sourceId"],
    },
  };
}

function routeHasTarget(
  route: InboundSignalRouteConfig,
  name: string,
): boolean {
  return route.targets.some(
    (target) => target.kind === "workflow" && target.name === name,
  );
}

function routeOverlapsGithubMention(route: InboundSignalRouteConfig): boolean {
  return (
    (route.provider === undefined || route.provider === "github") &&
    (route.channel === undefined || route.channel === "github.issue_comment")
  );
}

function appendProgressReviewerTarget(
  routes: readonly InboundSignalRouteConfig[],
  workflowNames: ReadonlySet<string>,
): InboundSignalRouteConfig[] {
  const target = progressReviewerTarget(workflowNames);
  if (!target) return [...routes];
  return routes.map((route) =>
    routeHasTarget(route, target.name)
      ? route
      : { ...route, targets: [...route.targets, target] },
  );
}

function defaultRoutingConfig(
  context: InboundSignalRouteValidationContext,
): InboundSignalRoutingConfig {
  const routes: InboundSignalRouteConfig[] = [];
  const targets: InboundSignalRouteTargetConfig[] = [
    ...(context.workflowNames.has("github-mention-intake")
      ? [{ kind: "workflow" as const, name: "github-mention-intake" }]
      : []),
    ...(context.workflowNames.has("github-mention-responder")
      ? [{ kind: "workflow" as const, name: "github-mention-responder" }]
      : []),
  ];
  const reviewer = progressReviewerTarget(context.workflowNames);
  if (reviewer) targets.push(reviewer);
  if (targets.length > 0) {
    routes.push({
      id: "github-issue-comment-mentions",
      provider: "github",
      channel: "github.issue_comment",
      targets,
    });
  }
  return { routes };
}

function effectiveRoutingConfig(
  ctx: ModuleContext,
  context = routingValidationContext(ctx),
): InboundSignalRoutingConfig {
  const configuredRoutes = routingConfig(ctx).routes ?? [];
  const defaults = defaultRoutingConfig(context).routes ?? [];
  const retainedDefaults = defaults.filter(
    (route) =>
      !configuredRoutes.some((configured) =>
        route.id === configured.id || routeOverlapsGithubMention(configured)
      ),
  );
  return {
    routes: appendProgressReviewerTarget(
      [...configuredRoutes, ...retainedDefaults],
      context.workflowNames,
    ),
  };
}

function filterProjectRoutes(
  status: InboundSignalRoutingStatus,
  projectId: string | undefined,
): InboundSignalRoutingStatus {
  if (!projectId) return status;
  return {
    ...status,
    routes: status.routes.filter((route) =>
      route.scopeId === projectId || route.scopeId === "(signal scope)"
    ),
  };
}

function buildRoutingStatus(
  ctx: ModuleContext,
  projectId?: string,
): InboundSignalRoutingStatus {
  const context = routingValidationContext(ctx);
  return filterProjectRoutes(
    inboundSignalRoutingStatus(effectiveRoutingConfig(ctx, context), context),
    projectId,
  );
}

function buildInboundSignalsLocalClient(ctx: ModuleContext): InboundSignalsClient {
  return {
    async listRoutes(project?: InboundSignalProjectSelection) {
      return buildRoutingStatus(ctx, project?.projectId);
    },
    async validateRoutes(project?: InboundSignalProjectSelection) {
      return buildRoutingStatus(ctx, project?.projectId).validation;
    },
  };
}

async function triggerInboundSignalAgent(
  ctx: ModuleContext,
  name: string,
  options: InboundSignalAgentTriggerOptions,
): Promise<InboundSignalAgentTriggerResult> {
  const harness = ctx.config.defaultAgentHarness ?? resolveActivePresetFromConfig(ctx.config).harness;
  const modelProvider = modelProviderSelectionFromConfig(ctx.config);
  const result = await withHandoffAgentRuntime(
    {
      cwd: ctx.cwd,
      harness,
      resolveAgentDef: ctx.resolveAgentDef,
      resolveSkillsPrompt: ctx.resolveSkillsPrompt,
      ...(modelProvider !== undefined ? { modelProvider } : {}),
      ...(ctx.config.modelOutputTokenLimits !== undefined
        ? { modelOutputTokenLimits: ctx.config.modelOutputTokenLimits }
        : {}),
      delegateBudget: createDelegateBudget(),
    },
    () =>
      runHandoffAgent(
        {
          agent: name,
          mode: "call",
          input: options.payload,
          reason: "Inbound signal route matched this registered agent target.",
          autonomy_mode: options.autonomyMode,
          budget: { max_turns: options.maxTurns },
          scope: {
            scope_id: String(options.payload.scopeId),
            project_id: String(options.payload.projectId),
          },
        },
        {
          scopeId: String(options.payload.scopeId),
          projectId: String(options.payload.projectId),
        },
      ),
  );
  if (result.is_error) {
    return { ok: false, reason: result.content };
  }
  const childSessionId = result.structuredContent?.childSessionId;
  return {
    ok: true,
    ...(typeof childSessionId === "string" && childSessionId.length > 0
      ? { sessionId: childSessionId }
      : {}),
  };
}

function query(project?: InboundSignalProjectSelection): string {
  if (!project?.projectId) return "";
  const params = new URLSearchParams();
  params.set("projectId", project.projectId);
  return `?${params.toString()}`;
}

function buildInboundSignalsDaemonClient(
  link: DaemonTransport,
): InboundSignalsClient {
  return {
    async listRoutes(project?: InboundSignalProjectSelection) {
      const result = await link.request<InboundSignalRoutingStatus>(
        "GET",
        `/inbound-signals/routes${query(project)}`,
      );
      if (!result) {
        throw new Error("Daemon unreachable while listing inbound signal routes");
      }
      return result;
    },
    async validateRoutes(project?: InboundSignalProjectSelection) {
      return (await this.listRoutes(project)).validation;
    },
  };
}

const inboundSignalsModule: KotaModule = {
  name: "inbound-signals",
  version: "1.0.0",
  description:
    "Typed project-scoped inbound external signal contract and routing dispatcher for workflow automation",
  dependencies: ["rendering", "workflow-ops"],
  events: [inboundSignalReceived, inboundSignalRouted],
  commands: (ctx) => {
    const root = new Command("__root__");
    root.addCommand(buildInboundSignalsCommand(ctx));
    return [...root.commands];
  },
  routes: (ctx) => inboundSignalRouteStatusRoutes((projectId) =>
    buildRoutingStatus(ctx, projectId)
  ),
  controlRoutes: (ctx) => inboundSignalRouteStatusControlRoutes((projectId) =>
    buildRoutingStatus(ctx, projectId)
  ),
  localClient: (ctx) => ({
    inboundSignals: buildInboundSignalsLocalClient(ctx),
  }),
  daemonClient: (link) => ({
    inboundSignals: buildInboundSignalsDaemonClient(link),
  }),
  onLoad: (ctx) => {
    unsubscribeInboundSignals?.();
    unsubscribeInboundSignals = ctx.events.subscribe(
      inboundSignalReceived,
      (signal) => {
        const context = routingValidationContext(ctx);
        void dispatchInboundSignalRoute({
          config: effectiveRoutingConfig(ctx, context),
          signal,
          context,
          deps: {
            triggerWorkflow: (name, options) =>
              ctx.client.workflow.triggerByName(name, options),
            batchWorkflow: (input) => {
              const dispatcher = ctx.getProvider(WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE);
              if (!dispatcher) {
                return {
                  ok: false,
                  reason: "unknown_workflow",
                  message: "workflow event dispatcher is unavailable",
                };
              }
              return dispatcher.enqueueBatchedEvent(input);
            },
            triggerAgent: (name, options) =>
              triggerInboundSignalAgent(ctx, name, options),
            emitRouted: (payload) => ctx.events.emit(inboundSignalRouted, payload),
          },
        }).catch((err) => {
          ctx.log.error(
            `inbound-signals route dispatch failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      },
    );
  },
  onUnload: () => {
    unsubscribeInboundSignals?.();
    unsubscribeInboundSignals = null;
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      routes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "targets"],
          properties: {
            id: { type: "string", minLength: 1 },
            provider: { type: "string", minLength: 1 },
            channel: { type: "string", minLength: 1 },
            accountId: { type: "string", minLength: 1 },
            sourceId: { type: "string", minLength: 1 },
            actorTrust: {
              type: "string",
              enum: ["trusted", "untrusted", "blocked"],
            },
            scopeId: { type: "string", minLength: 1 },
            sourceStatus: {
              type: "string",
              enum: ["active", "blocked", "archived", "ignored"],
            },
            blockedHandling: {
              type: "string",
              enum: ["audit-only", "dispatch"],
            },
            targets: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "name"],
                properties: {
                  kind: { type: "string", enum: ["workflow", "agent"] },
                  name: { type: "string", minLength: 1 },
                  maxTurns: { type: "integer", minimum: 1 },
                  batch: {
                    type: "object",
                    additionalProperties: false,
                    required: ["mode"],
                    properties: {
                      mode: { type: "string", enum: ["workflow-trigger"] },
                      maxItems: { type: "integer", minimum: 1 },
                      maxAgeMs: { type: "integer", minimum: 1 },
                      idleMs: { type: "integer", minimum: 1 },
                      maxBufferSize: { type: "integer", minimum: 1 },
                      overflow: {
                        type: "string",
                        enum: ["drop-newest", "flush-oldest"],
                      },
                      groupBy: {
                        type: "array",
                        uniqueItems: true,
                        items: {
                          type: "string",
                          enum: [
                            "provider",
                            "channel",
                            "accountId",
                            "sourceId",
                            "actorTrust",
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
            batch: {
              type: "object",
              additionalProperties: false,
              required: ["mode"],
              properties: {
                mode: { type: "string", enum: ["workflow-trigger"] },
                maxItems: { type: "integer", minimum: 1 },
                maxAgeMs: { type: "integer", minimum: 1 },
                idleMs: { type: "integer", minimum: 1 },
                maxBufferSize: { type: "integer", minimum: 1 },
                overflow: {
                  type: "string",
                  enum: ["drop-newest", "flush-oldest"],
                },
                groupBy: {
                  type: "array",
                  uniqueItems: true,
                  items: {
                    type: "string",
                    enum: [
                      "provider",
                      "channel",
                      "accountId",
                      "sourceId",
                      "actorTrust",
                    ],
                  },
                },
              },
            },
            processing: {
              type: "object",
              additionalProperties: false,
              properties: {
                classifier: { type: "string", enum: ["none", "cheap"] },
                modelTier: {
                  type: "string",
                  enum: ["fast", "balanced", "capable"],
                },
                allowNonReadActions: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};

export default inboundSignalsModule;
