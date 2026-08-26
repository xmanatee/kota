import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import {
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import {
  type AutonomyIssueSourceContext,
  subscribeAutonomyIssueSources,
} from "./autonomy-issue-sources.js";
import { createTestScopeRuntime } from "./autonomy-runtime.test-helpers.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "./health-signal.js";
import {
  buildAutonomyHealthReviewFromSignals,
  finalizeAutonomyHealthReviewActions,
  stageAutonomyHealthReviewActions,
} from "./workflows/autonomy-health-reviewer/health-review.js";

export const ISSUE_SOURCE_SCOPE_ID = "scope-fixture";

export function makeAutonomyIssueSourceContext(
  scopeRoot: string,
  bus: EventBus,
  scopeId = ISSUE_SOURCE_SCOPE_ID,
): { ctx: AutonomyIssueSourceContext; runtime: ScopeRuntime } {
  const runtime = createTestScopeRuntime({
    scope: { scopeId: scopeId, scopeRoot, displayName: scopeId },
    bus,
    onLog: () => {},
    installSingletons: false,
  });
  const registry = new ProviderRegistry();
  registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "test", {
    resolve: (selectedId) =>
      selectedId === scopeId
        ? { ok: true, runtime }
        : { ok: false, scopeId: selectedId },
  });
  return {
    ctx: {
      events: makeStubEventProxy(bus),
      getProvider: (token) => registry.get(token),
    },
    runtime,
  };
}

export function wireAutonomyIssueSourceFixture(scopeRoot: string): {
  pbus: ScopedEventBus;
  signals: AutonomyHealthSignal[];
  runtime: ScopeRuntime;
} {
  const bus = new EventBus();
  const pbus = new ScopedEventBus(bus, ISSUE_SOURCE_SCOPE_ID);
  const signals: AutonomyHealthSignal[] = [];
  bus.on(autonomyHealthSignal, (payload) => signals.push(payload));
  const { ctx, runtime } = makeAutonomyIssueSourceContext(scopeRoot, bus);
  subscribeAutonomyIssueSources(ctx);
  return { pbus, signals, runtime };
}

export function applyHealthReviewSignals(args: {
  scopeRoot: string;
  signals: readonly AutonomyHealthSignal[];
  generatedAt: string;
  reason: string;
}) {
  const review = buildAutonomyHealthReviewFromSignals({
    signals: args.signals,
    generatedAt: args.generatedAt,
    sourceEventName: "autonomy.health.signal",
    reason: args.reason,
  });
  const currentProjection = readAutonomyIssueProjection(args.scopeRoot);
  const repositoryActions = stageAutonomyHealthReviewActions({
    workspaceRoot: args.scopeRoot,
    currentProjection,
    scopeRoot: args.scopeRoot,
    review,
  });
  const finalized = finalizeAutonomyHealthReviewActions({
    currentProjection,
    scopeRoot: args.scopeRoot,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(args.scopeRoot, ".kota", "owner-questions"),
    ),
    review,
    repositoryActions,
  });
  materializeAutonomyIssueProjection(args.scopeRoot, finalized.projection);
  return finalized;
}
