import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
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
import { createTestProjectRuntime } from "./autonomy-runtime.test-helpers.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "./health-signal.js";
import {
  buildAutonomyHealthReviewFromSignals,
  applyAutonomyHealthReviewActions,
  planAutonomyHealthReviewActions,
} from "./workflows/autonomy-health-reviewer/health-review.js";

export const ISSUE_SOURCE_SCOPE_ID = "scope-fixture";

export function makeAutonomyIssueSourceContext(
  projectDir: string,
  bus: EventBus,
  scopeId = ISSUE_SOURCE_SCOPE_ID,
): { ctx: AutonomyIssueSourceContext; runtime: ProjectRuntime } {
  const runtime = createTestProjectRuntime({
    project: { projectId: scopeId, projectDir, displayName: scopeId },
    bus,
    onLog: () => {},
    installSingletons: false,
  });
  const registry = new ProviderRegistry();
  registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "test", {
    resolve: (selectedId) =>
      selectedId === scopeId
        ? { ok: true, runtime }
        : { ok: false, projectId: selectedId },
  });
  return {
    ctx: {
      events: makeStubEventProxy(bus),
      getProvider: (token) => registry.get(token),
    },
    runtime,
  };
}

export function wireAutonomyIssueSourceFixture(projectDir: string): {
  pbus: ProjectScopedEventBus;
  signals: AutonomyHealthSignal[];
  runtime: ProjectRuntime;
} {
  const bus = new EventBus();
  const pbus = new ProjectScopedEventBus(bus, ISSUE_SOURCE_SCOPE_ID);
  const signals: AutonomyHealthSignal[] = [];
  bus.on(autonomyHealthSignal, (payload) => signals.push(payload));
  const { ctx, runtime } = makeAutonomyIssueSourceContext(projectDir, bus);
  subscribeAutonomyIssueSources(ctx);
  return { pbus, signals, runtime };
}

export function applyHealthReviewSignals(args: {
  projectDir: string;
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
  const currentProjection = readAutonomyIssueProjection(args.projectDir);
  const plannedActions = planAutonomyHealthReviewActions({
    projectDir: args.projectDir,
    currentProjection,
    scopeDir: args.projectDir,
    review,
  });
  const finalized = applyAutonomyHealthReviewActions({
    currentProjection,
    scopeDir: args.projectDir,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(args.projectDir, ".kota", "owner-questions"),
    ),
    review,
    plannedActions,
  });
  materializeAutonomyIssueProjection(args.projectDir, finalized.projection);
  return finalized;
}
