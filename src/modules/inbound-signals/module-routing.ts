import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalRouteConfig,
  type InboundSignalRouteTargetConfig,
  type InboundSignalRouteValidationContext,
  type InboundSignalRoutingConfig,
  type InboundSignalRoutingStatus,
  inboundSignalRoutingStatus,
} from "./routing.js";

function routingConfig(ctx: ModuleContext): InboundSignalRoutingConfig {
  return ctx.getModuleConfig<InboundSignalRoutingConfig>() ?? {};
}

export function routingValidationContext(
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

export function effectiveRoutingConfig(
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

export function buildRoutingStatus(
  ctx: ModuleContext,
  projectId?: string,
): InboundSignalRoutingStatus {
  const context = routingValidationContext(ctx);
  return filterProjectRoutes(
    inboundSignalRoutingStatus(effectiveRoutingConfig(ctx, context), context),
    projectId,
  );
}
