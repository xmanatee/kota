import {
  type InboundSignalReceivedPayload,
  type InboundSignalRoutedPayload,
  type InboundSignalRouteTargetResult,
  type InboundSignalSourceStatus,
  inboundSignalReceived,
  inboundSignalWorkflowTargeted,
} from "./events.js";
import { workflowBatchTrigger } from "./routing-batch.js";
import { selectInboundSignalRouteOutcome } from "./routing-matching.js";
import {
  agentTargetAutonomyMode,
  agentTriggerPayload,
  routedPayload,
  skippedTargets,
  workflowTriggerPayload,
} from "./routing-payloads.js";
import type {
  InboundSignalAgentRouteTargetConfig,
  InboundSignalBatchPolicy,
  InboundSignalRouteConfig,
  InboundSignalRouteDispatchArgs,
  InboundSignalRouteDispatchDependency,
  InboundSignalWorkflowRouteTargetConfig,
} from "./routing-types.js";

function workflowTargetBatch(
  route: InboundSignalRouteConfig,
  target: InboundSignalWorkflowRouteTargetConfig,
): InboundSignalBatchPolicy | undefined {
  return target.batch ?? route.batch;
}

async function dispatchAgentTarget(
  route: InboundSignalRouteConfig,
  signal: InboundSignalReceivedPayload,
  target: InboundSignalAgentRouteTargetConfig,
  sourceStatus: InboundSignalSourceStatus,
  deps: InboundSignalRouteDispatchDependency,
): Promise<InboundSignalRouteTargetResult> {
  if (!deps.triggerAgent) {
    return {
      kind: target.kind,
      name: target.name,
      status: "failed",
      reason: "agent route target dispatch dependency is unavailable",
    };
  }
  try {
    const result = await deps.triggerAgent(target.name, {
      maxTurns: target.maxTurns,
      autonomyMode: agentTargetAutonomyMode(route),
      payload: agentTriggerPayload({ signal, route, target, sourceStatus }),
    });
    if (!result.ok) {
      return {
        kind: target.kind,
        name: target.name,
        status: "failed",
        reason: result.reason,
      };
    }
    return {
      kind: target.kind,
      name: target.name,
      status: "completed",
      ...(result.sessionId !== undefined && { sessionId: result.sessionId }),
    };
  } catch (err) {
    return {
      kind: target.kind,
      name: target.name,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function dispatchTargets(
  route: InboundSignalRouteConfig,
  signal: InboundSignalReceivedPayload,
  sourceStatus: InboundSignalSourceStatus,
  deps: InboundSignalRouteDispatchDependency,
): Promise<readonly InboundSignalRouteTargetResult[]> {
  const results: InboundSignalRouteTargetResult[] = [];
  for (const target of route.targets) {
    if (target.kind === "agent") {
      results.push(await dispatchAgentTarget(route, signal, target, sourceStatus, deps));
      continue;
    }
    const batch = workflowTargetBatch(route, target);
    if (batch) {
      if (!deps.batchWorkflow) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "failed",
          reason: "workflow batch dispatch dependency is unavailable",
        });
        continue;
      }
      try {
        const result = await deps.batchWorkflow({
          workflowName: target.name,
          event: inboundSignalReceived.name,
          schemaRef: null,
          payload: workflowTriggerPayload({ signal, route, target, sourceStatus }),
          batch: workflowBatchTrigger(batch),
        });
        if (result.ok) {
          results.push({
            kind: target.kind,
            name: target.name,
            status: result.status === "queued" ? "queued" : "batched",
          });
        } else {
          results.push({
            kind: target.kind,
            name: target.name,
            status: "failed",
            reason: result.message,
          });
        }
      } catch (err) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    try {
      const result = await deps.triggerWorkflow(target.name, {
        event: inboundSignalWorkflowTargeted,
        payload: workflowTriggerPayload({ signal, route, target, sourceStatus }),
      });
      if (result.ok) {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "queued",
          ...(result.runId !== undefined && { runId: result.runId }),
        });
      } else {
        results.push({
          kind: target.kind,
          name: target.name,
          status: "already-queued",
          reason: "workflow already has a pending run",
        });
      }
    } catch (err) {
      results.push({
        kind: target.kind,
        name: target.name,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function dispatchInboundSignalRoute(
  args: InboundSignalRouteDispatchArgs,
): Promise<InboundSignalRoutedPayload> {
  const outcome = selectInboundSignalRouteOutcome(
    args.config,
    args.signal,
    args.context,
  );
  if (!outcome.route || outcome.decision !== "dispatched") {
    const payload = routedPayload({
      signal: args.signal,
      route: outcome.route,
      decision: outcome.decision,
      sourceStatus: outcome.sourceStatus,
      targets: skippedTargets(outcome.route, outcome.reason),
      reason: outcome.reason,
    });
    args.deps.emitRouted(payload);
    return payload;
  }

  const targets = await dispatchTargets(
    outcome.route,
    args.signal,
    outcome.sourceStatus,
    args.deps,
  );
  const payload = routedPayload({
    signal: args.signal,
    route: outcome.route,
    decision: "dispatched",
    sourceStatus: outcome.sourceStatus,
    targets,
    reason: outcome.reason,
  });
  args.deps.emitRouted(payload);
  return payload;
}
