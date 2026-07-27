import {
  type RiskTier,
  riskFromEffect,
  type ToolEffect,
} from "#core/tools/effect.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowTriggerInput } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  ModuleSetupCapabilityStatus,
  ModuleSetupPendingAction,
  ModuleSetupRequirementStatus,
  ModuleSetupStatusState,
} from "./setup-requirements.js";

export type ModuleManifestScope = "global" | "project" | "daemon" | "external";
export type ModuleManifestScopePolicyHook =
  | "autonomy"
  | "channels"
  | "external-effects"
  | "owner-confirmation"
  | "retention"
  | "setup"
  | "writes";

export type ModuleManifestDataSensitivity =
  | "public"
  | "internal"
  | "personal"
  | "secret"
  | "credential"
  | "provider-payload"
  | "browser-profile";

export type ModuleManifestRetentionPosture =
  | "ephemeral"
  | "project-durable"
  | "run-artifact"
  | "external-provider"
  | "operator-visible";

export type ModuleManifestRedactionPosture =
  | "none"
  | "metadata-only"
  | "mask-secret"
  | "omit-payload"
  | "hash";

export type ModuleManifestEffectSource =
  | "tool"
  | "channel"
  | "route"
  | "control-route"
  | "workflow"
  | "client"
  | "lifecycle"
  | "notification";

export type ModuleManifestEffectCategory =
  | "network-read"
  | "external-write"
  | "local-write"
  | "daemon-mutation"
  | "notification"
  | "owner-visible"
  | "credential"
  | "session-write"
  | "destructive";

export type ModuleManifestSimulationSupport =
  | "full"
  | "local-isolated"
  | "external-effects-blocked"
  | "unsupported";
export type ModuleManifestSetupMode = "form" | "url" | "none";

export type ModuleManifestCapability = {
  id: string;
  description: string;
  scope: ModuleManifestScope;
  scopePolicyHooks: readonly ModuleManifestScopePolicyHook[];
  setupRequirementIds?: readonly string[];
  readinessIds?: readonly string[];
};

export type ModuleManifestDataClass = {
  id: string;
  description: string;
  sensitivity: ModuleManifestDataSensitivity;
  retention: ModuleManifestRetentionPosture;
  redaction: ModuleManifestRedactionPosture;
};

export type ModuleManifestSimulation = {
  support: ModuleManifestSimulationSupport;
  blockedReasons: readonly string[];
};

export type ModuleManifestAdditionalEffect = {
  id: string;
  description: string;
  source: ModuleManifestEffectSource;
  effect: ToolEffect;
  capabilityIds: readonly string[];
};

export type ModuleManifestEffectDeclaration = {
  id: string;
  description: string;
  source: ModuleManifestEffectSource;
  effect: ToolEffect;
  capabilityIds?: readonly string[];
};

export type ModuleCapabilityManifestInput = {
  schemaVersion: 1;
  capabilities: readonly ModuleManifestCapability[];
  dataClasses: readonly ModuleManifestDataClass[];
  simulation: ModuleManifestSimulation;
  additionalEffects?: readonly ModuleManifestAdditionalEffect[];
};

export type ModuleManifestToolSnapshot = {
  name: string;
  description: string;
  effect: ToolEffect;
};

export type ModuleManifestSetupStatusLinks = {
  list: string;
  refresh: string;
  revoke: string;
  submitForm?: string;
  storeSecret?: string;
  start?: string;
};

export type ModuleManifestSetupAvailabilitySnapshot = {
  state: ModuleSetupStatusState;
  reason: string;
  message: string;
  capabilities?: readonly ModuleSetupCapabilityStatus[];
  pendingAction?: ModuleSetupPendingAction & { complete: string };
};

export type ModuleManifestSetupSnapshot = {
  id: string;
  kind: string;
  setupMode: ModuleManifestSetupMode;
  sensitivity: string;
  required: boolean;
  healthCapabilityIds: readonly string[];
  statusLinks: ModuleManifestSetupStatusLinks;
  availability?: ModuleManifestSetupAvailabilitySnapshot;
};

export type ModuleManifestEventProducer = {
  workflow: string;
  stepId: string;
};

export type ModuleManifestEventConsumer = {
  workflow: string;
  source: "trigger" | "await-event";
  filter?: string;
  stepId?: string;
};

export type ModuleManifestEventProjection = {
  name: string;
  declared: boolean;
  producers: readonly ModuleManifestEventProducer[];
  consumers: readonly ModuleManifestEventConsumer[];
};

export type ModuleManifestContributionSnapshot = {
  dependencies: readonly string[];
  tools: readonly ModuleManifestToolSnapshot[];
  effects: readonly ModuleManifestEffectDeclaration[];
  workflows: readonly string[];
  workflowTriggers: readonly string[];
  channels: readonly string[];
  skills: readonly string[];
  agents: readonly string[];
  commands: readonly string[];
  routes: readonly string[];
  controlRoutes: readonly string[];
  events: readonly string[];
  eventFlows: readonly ModuleManifestEventProjection[];
  localClientNamespaces: readonly string[];
  hasDaemonClientFactory: boolean;
  setupRequirements: readonly ModuleManifestSetupSnapshot[];
  hasHealthCheck: boolean;
};

export type ModuleManifestEffectProjection = {
  id: string;
  description: string;
  source: ModuleManifestEffectSource;
  target: string;
  effect: ToolEffect;
  risk: RiskTier;
  categories: readonly ModuleManifestEffectCategory[];
  capabilityIds: readonly string[];
  simulation: {
    blocked: boolean;
    reason?: string;
  };
};

export type ModuleCapabilityManifestProjection = {
  schemaVersion: 1;
  moduleName: string;
  dependencies: readonly string[];
  capabilities: readonly ModuleManifestCapability[];
  dataClasses: readonly ModuleManifestDataClass[];
  contributions: {
    tools: readonly string[];
    workflows: readonly string[];
    workflowTriggers: readonly string[];
    channels: readonly string[];
    skills: readonly string[];
    agents: readonly string[];
    commands: readonly string[];
    routes: readonly string[];
    controlRoutes: readonly string[];
    events: readonly string[];
    eventFlows: readonly ModuleManifestEventProjection[];
    clients: {
      localNamespaces: readonly string[];
      daemonFactory: boolean;
    };
    setupRequirements: readonly ModuleManifestSetupSnapshot[];
  };
  effects: readonly ModuleManifestEffectProjection[];
  simulation: ModuleManifestSimulation;
  readiness: {
    setupRequirementIds: readonly string[];
    healthCapabilityIds: readonly string[];
    healthCheck: "declared" | "not-declared";
  };
};

export type ModuleManifestEffectLookup = ModuleManifestEffectProjection & {
  moduleName: string;
};

const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const MANIFEST_SCOPES = ["global", "project", "daemon", "external"] as const;
const MANIFEST_SCOPE_POLICY_HOOKS = [
  "autonomy",
  "channels",
  "external-effects",
  "owner-confirmation",
  "retention",
  "setup",
  "writes",
] as const;
const MANIFEST_DATA_SENSITIVITIES = [
  "public",
  "internal",
  "personal",
  "secret",
  "credential",
  "provider-payload",
  "browser-profile",
] as const;
const MANIFEST_RETENTION_POSTURES = [
  "ephemeral",
  "project-durable",
  "run-artifact",
  "external-provider",
  "operator-visible",
] as const;
const MANIFEST_REDACTION_POSTURES = [
  "none",
  "metadata-only",
  "mask-secret",
  "omit-payload",
  "hash",
] as const;
const MANIFEST_EFFECT_SOURCES = [
  "tool",
  "channel",
  "route",
  "control-route",
  "workflow",
  "client",
  "lifecycle",
  "notification",
] as const;
const MANIFEST_SIMULATION_SUPPORTS = [
  "full",
  "local-isolated",
  "external-effects-blocked",
  "unsupported",
] as const;
const TOOL_EFFECT_KINDS = ["read", "write", "destructive"] as const;
const TOOL_EFFECT_SCOPES = [
  "session",
  "local-fs",
  "daemon-state",
  "process-env",
  "external-network",
  "operator-surface",
] as const;

const moduleManifestProjections = new Map<string, ModuleCapabilityManifestProjection>();

export function registerModuleCapabilityManifestProjection(
  projection: ModuleCapabilityManifestProjection,
): void {
  moduleManifestProjections.set(projection.moduleName, projection);
}

export function unregisterModuleCapabilityManifestProjection(
  moduleName: string,
): void {
  moduleManifestProjections.delete(moduleName);
}

export function clearModuleCapabilityManifestProjections(): void {
  moduleManifestProjections.clear();
}

export function getModuleCapabilityManifestProjections(): readonly ModuleCapabilityManifestProjection[] {
  return [...moduleManifestProjections.values()];
}

export function findModuleManifestToolEffect(
  toolName: string,
): ModuleManifestEffectLookup | undefined {
  for (const projection of moduleManifestProjections.values()) {
    const effect = projection.effects.find(
      (candidate) =>
        candidate.source === "tool" &&
        candidate.target === toolName,
    );
    if (effect) return { ...effect, moduleName: projection.moduleName };
  }
  return undefined;
}

function isLiteral<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return allowed.includes(value as T);
}

function assertObject(moduleName: string, label: string, value: object): void {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return;
  throw new Error(`Module "${moduleName}" manifest ${label} must be an object`);
}

function assertArray<T>(
  moduleName: string,
  label: string,
  value: readonly T[],
): void {
  if (Array.isArray(value)) return;
  throw new Error(`Module "${moduleName}" manifest ${label} must be an array`);
}

function assertString(moduleName: string, label: string, value: string): void {
  if (typeof value === "string") return;
  throw new Error(`Module "${moduleName}" manifest ${label} must be a string`);
}

function assertBoolean(moduleName: string, label: string, value: boolean): void {
  if (typeof value === "boolean") return;
  throw new Error(`Module "${moduleName}" manifest ${label} must be a boolean`);
}

function assertLiteral<T extends string>(
  moduleName: string,
  label: string,
  value: string,
  allowed: readonly T[],
): asserts value is T {
  assertString(moduleName, label, value);
  if (isLiteral(value, allowed)) return;
  throw new Error(
    `Module "${moduleName}" manifest ${label} has unknown value "${value}"`,
  );
}

function assertManifestId(moduleName: string, label: string, value: string): void {
  assertString(moduleName, `${label} id`, value);
  if (MANIFEST_ID_PATTERN.test(value)) return;
  throw new Error(
    `Module "${moduleName}" manifest ${label} id "${value}" must match ${MANIFEST_ID_PATTERN.source}`,
  );
}

function assertNonEmpty(moduleName: string, label: string, value: string): void {
  assertString(moduleName, label, value);
  if (value.trim().length > 0) return;
  throw new Error(`Module "${moduleName}" manifest ${label} must not be empty`);
}

function validateStringArray(
  moduleName: string,
  label: string,
  values: readonly string[],
): void {
  assertArray(moduleName, label, values);
  for (const value of values) assertString(moduleName, `${label} entry`, value);
}

function validateOptionalStringArray(
  moduleName: string,
  label: string,
  values: readonly string[] | undefined,
): void {
  if (values === undefined) return;
  validateStringArray(moduleName, label, values);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateToolEffect(
  moduleName: string,
  label: string,
  effect: ToolEffect,
): void {
  assertObject(moduleName, label, effect);
  assertLiteral(moduleName, `${label} kind`, effect.kind, TOOL_EFFECT_KINDS);
  assertLiteral(moduleName, `${label} scope`, effect.scope, TOOL_EFFECT_SCOPES);
  assertBoolean(moduleName, `${label} idempotent`, effect.idempotent);
  assertBoolean(moduleName, `${label} openWorld`, effect.openWorld);
}

function validateCapabilityIds(
  moduleName: string,
  capabilities: readonly ModuleManifestCapability[],
): Set<string> {
  assertArray(moduleName, "capabilities", capabilities);
  const ids = new Set<string>();
  for (const capability of capabilities) {
    assertObject(moduleName, "capability", capability);
    assertManifestId(moduleName, "capability", capability.id);
    assertNonEmpty(moduleName, `capability "${capability.id}" description`, capability.description);
    assertLiteral(
      moduleName,
      `capability "${capability.id}" scope`,
      capability.scope,
      MANIFEST_SCOPES,
    );
    assertArray(
      moduleName,
      `capability "${capability.id}" scopePolicyHooks`,
      capability.scopePolicyHooks,
    );
    for (const hook of capability.scopePolicyHooks) {
      assertLiteral(
        moduleName,
        `capability "${capability.id}" scopePolicyHook`,
        hook,
        MANIFEST_SCOPE_POLICY_HOOKS,
      );
    }
    if (ids.has(capability.id)) {
      throw new Error(
        `Module "${moduleName}" manifest declares duplicate capability id "${capability.id}"`,
      );
    }
    ids.add(capability.id);
    validateOptionalStringArray(
      moduleName,
      `capability "${capability.id}" setupRequirementIds`,
      capability.setupRequirementIds,
    );
    for (const setupRequirementId of capability.setupRequirementIds ?? []) {
      assertManifestId(
        moduleName,
        `capability "${capability.id}" setup requirement`,
        setupRequirementId,
      );
    }
    validateOptionalStringArray(
      moduleName,
      `capability "${capability.id}" readinessIds`,
      capability.readinessIds,
    );
    for (const readinessId of capability.readinessIds ?? []) {
      assertNonEmpty(
        moduleName,
        `capability "${capability.id}" readiness id`,
        readinessId,
      );
    }
  }
  return ids;
}

function validateManifestInput(
  moduleName: string,
  manifest: ModuleCapabilityManifestInput,
): Set<string> {
  assertObject(moduleName, "root", manifest);
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Module "${moduleName}" manifest schemaVersion must be 1`,
    );
  }
  assertArray(moduleName, "dataClasses", manifest.dataClasses);
  assertObject(moduleName, "simulation", manifest.simulation);
  assertLiteral(
    moduleName,
    "simulation support",
    manifest.simulation.support,
    MANIFEST_SIMULATION_SUPPORTS,
  );
  validateStringArray(
    moduleName,
    "simulation blockedReasons",
    manifest.simulation.blockedReasons,
  );
  if (manifest.additionalEffects !== undefined) {
    assertArray(moduleName, "additionalEffects", manifest.additionalEffects);
  }
  assertArray(moduleName, "capabilities", manifest.capabilities);
  if (manifest.capabilities.length === 0) {
    throw new Error(
      `Module "${moduleName}" manifest must declare at least one capability`,
    );
  }
  const capabilityIds = validateCapabilityIds(moduleName, manifest.capabilities);
  const dataClassIds = new Set<string>();
  for (const dataClass of manifest.dataClasses) {
    assertObject(moduleName, "data class", dataClass);
    assertManifestId(moduleName, "data class", dataClass.id);
    assertNonEmpty(moduleName, `data class "${dataClass.id}" description`, dataClass.description);
    assertLiteral(
      moduleName,
      `data class "${dataClass.id}" sensitivity`,
      dataClass.sensitivity,
      MANIFEST_DATA_SENSITIVITIES,
    );
    assertLiteral(
      moduleName,
      `data class "${dataClass.id}" retention`,
      dataClass.retention,
      MANIFEST_RETENTION_POSTURES,
    );
    assertLiteral(
      moduleName,
      `data class "${dataClass.id}" redaction`,
      dataClass.redaction,
      MANIFEST_REDACTION_POSTURES,
    );
    if (dataClassIds.has(dataClass.id)) {
      throw new Error(
        `Module "${moduleName}" manifest declares duplicate data class id "${dataClass.id}"`,
      );
    }
    dataClassIds.add(dataClass.id);
  }
  for (const reason of manifest.simulation.blockedReasons) {
    assertNonEmpty(moduleName, "simulation blocked reason", reason);
  }
  const effectIds = new Set<string>();
  for (const additionalEffect of manifest.additionalEffects ?? []) {
    validateEffectDeclaration(moduleName, additionalEffect);
    if (effectIds.has(additionalEffect.id)) {
      throw new Error(
        `Module "${moduleName}" manifest declares duplicate effect id "${additionalEffect.id}"`,
      );
    }
    effectIds.add(additionalEffect.id);
    if (additionalEffect.capabilityIds.length === 0) {
      throw new Error(
        `Module "${moduleName}" manifest effect "${additionalEffect.id}" must link to at least one capability id`,
      );
    }
    for (const capabilityId of additionalEffect.capabilityIds) {
      if (!capabilityIds.has(capabilityId)) {
        throw new Error(
          `Module "${moduleName}" manifest effect "${additionalEffect.id}" references unknown capability id "${capabilityId}"`,
        );
      }
    }
  }
  return capabilityIds;
}

function validateEffectDeclaration(
  moduleName: string,
  effect: ModuleManifestEffectDeclaration,
): void {
  assertObject(moduleName, "effect", effect);
  assertManifestId(moduleName, "effect", effect.id);
  assertNonEmpty(
    moduleName,
    `effect "${effect.id}" description`,
    effect.description,
  );
  assertLiteral(
    moduleName,
    `effect "${effect.id}" source`,
    effect.source,
    MANIFEST_EFFECT_SOURCES,
  );
  validateToolEffect(
    moduleName,
    `effect "${effect.id}" tool effect`,
    effect.effect,
  );
  validateOptionalStringArray(
    moduleName,
    `effect "${effect.id}" capabilityIds`,
    effect.capabilityIds,
  );
}

function validateEffectCapabilityLinks(
  moduleName: string,
  effect: ModuleManifestEffectDeclaration,
  capabilityIds: ReadonlySet<string>,
): void {
  if (effect.capabilityIds === undefined) return;
  if (effect.capabilityIds.length === 0) {
    throw new Error(
      `Module "${moduleName}" manifest effect "${effect.id}" must link to at least one capability id`,
    );
  }
  for (const capabilityId of effect.capabilityIds) {
    if (capabilityIds.has(capabilityId)) continue;
    throw new Error(
      `Module "${moduleName}" manifest effect "${effect.id}" references unknown capability id "${capabilityId}"`,
    );
  }
}

function validateModuleEffectDeclarations(
  moduleName: string,
  effects: readonly ModuleManifestEffectDeclaration[],
  capabilityIds: ReadonlySet<string>,
): void {
  const effectIds = new Set<string>();
  for (const effect of effects) {
    validateEffectDeclaration(moduleName, effect);
    if (effectIds.has(effect.id)) {
      throw new Error(
        `Module "${moduleName}" manifest declares duplicate effect id "${effect.id}"`,
      );
    }
    effectIds.add(effect.id);
    validateEffectCapabilityLinks(moduleName, effect, capabilityIds);
  }
}

function validateCapabilitySetupLinks(
  moduleName: string,
  capabilities: readonly ModuleManifestCapability[],
  setupRequirements: readonly ModuleManifestSetupSnapshot[],
): void {
  const setupIds = new Set(setupRequirements.map((req) => req.id));
  for (const capability of capabilities) {
    for (const setupRequirementId of capability.setupRequirementIds ?? []) {
      if (setupIds.has(setupRequirementId)) continue;
      throw new Error(
        `Module "${moduleName}" manifest capability "${capability.id}" references unknown setup requirement id "${setupRequirementId}"`,
      );
    }
  }
}

function triggerEventName(trigger: WorkflowTriggerInput): string | undefined {
  if (trigger.watch) return "files.changed";
  if (trigger.webhook) return "webhook";
  if (trigger.schedule || trigger.intervalMs !== undefined) return undefined;
  return trigger.event;
}

function triggerFilterLabel(trigger: WorkflowTriggerInput): string | undefined {
  if (!trigger.filter || Object.keys(trigger.filter).length === 0) return undefined;
  return Object.entries(trigger.filter)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
}

type MutableEventProjection = {
  declared: boolean;
  producers: ModuleManifestEventProducer[];
  consumers: ModuleManifestEventConsumer[];
};

function getOrCreateEventProjection(
  map: Map<string, MutableEventProjection>,
  eventName: string,
): MutableEventProjection {
  let projection = map.get(eventName);
  if (projection) return projection;
  projection = { declared: false, producers: [], consumers: [] };
  map.set(eventName, projection);
  return projection;
}

function collectStepEventFlows(
  workflowName: string,
  steps: readonly WorkflowStepInput[],
  eventMap: Map<string, MutableEventProjection>,
): void {
  for (const step of steps) {
    switch (step.type) {
      case "emit":
        getOrCreateEventProjection(eventMap, step.event).producers.push({
          workflow: workflowName,
          stepId: step.id,
        });
        break;
      case "await-event":
        getOrCreateEventProjection(eventMap, step.event).consumers.push({
          workflow: workflowName,
          source: "await-event",
          stepId: step.id,
        });
        break;
      case "branch":
        collectStepEventFlows(workflowName, step.ifTrue, eventMap);
        if (step.ifFalse) {
          collectStepEventFlows(workflowName, step.ifFalse, eventMap);
        }
        break;
      case "agent":
      case "approval":
      case "code":
      case "foreach":
      case "parallel":
      case "restart":
      case "tool":
      case "trigger":
        break;
    }
  }
}

export function buildModuleManifestEventFlows(args: {
  declaredEventNames: readonly string[];
  workflows: readonly RegisteredWorkflowDefinitionInput[];
}): ModuleManifestEventProjection[] {
  const eventMap = new Map<string, MutableEventProjection>();
  for (const eventName of args.declaredEventNames) {
    getOrCreateEventProjection(eventMap, eventName).declared = true;
  }
  for (const workflow of args.workflows) {
    for (const trigger of workflow.triggers) {
      const eventName = triggerEventName(trigger);
      if (!eventName) continue;
      const consumer: ModuleManifestEventConsumer = {
        workflow: workflow.name,
        source: "trigger",
        ...(triggerFilterLabel(trigger) !== undefined
          ? { filter: triggerFilterLabel(trigger) }
          : {}),
      };
      getOrCreateEventProjection(eventMap, eventName).consumers.push(consumer);
    }
    collectStepEventFlows(workflow.name, workflow.steps, eventMap);
  }
  return [...eventMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, projection]) => ({
      name,
      declared: projection.declared,
      producers: projection.producers,
      consumers: projection.consumers,
    }));
}

function inferredCapability(
  moduleName: string,
  snapshot: ModuleManifestContributionSnapshot,
): ModuleManifestCapability {
  const setupRequirementIds = snapshot.setupRequirements.map((req) => req.id);
  const readinessIds = unique(
    snapshot.setupRequirements.flatMap((req) => req.healthCapabilityIds),
  );
  return {
    id: `${moduleName}.runtime`,
    description: `Runtime capability surface for module "${moduleName}"`,
    scope: "daemon",
    scopePolicyHooks: [],
    ...(setupRequirementIds.length > 0 ? { setupRequirementIds } : {}),
    ...(readinessIds.length > 0 ? { readinessIds } : {}),
  };
}

export function effectCategoriesFromEffect(
  effect: ToolEffect,
): ModuleManifestEffectCategory[] {
  const categories: ModuleManifestEffectCategory[] = [];
  if (effect.kind === "destructive") categories.push("destructive");
  if (effect.scope === "external-network") {
    categories.push(effect.kind === "read" ? "network-read" : "external-write");
  }
  if (effect.scope === "local-fs" && effect.kind !== "read") {
    categories.push("local-write");
  }
  if (effect.scope === "daemon-state" && effect.kind !== "read") {
    categories.push("daemon-mutation");
  }
  if (effect.scope === "operator-surface") {
    categories.push("notification", "owner-visible");
  }
  if (effect.scope === "process-env" && effect.kind !== "read") {
    categories.push("credential");
  }
  if (effect.scope === "session" && effect.kind !== "read") {
    categories.push("session-write");
  }
  return categories;
}

function effectRequiresExplicitManifest(effect: ToolEffect): boolean {
  return effect.scope === "external-network" ||
    effect.scope === "operator-surface" ||
    effect.kind === "destructive";
}

export function simulationBlockReasonFromEffect(
  tool: string,
  effect: ToolEffect,
  opts: { canScopeLocalFs: boolean },
): string | undefined {
  if (effect.kind === "destructive") {
    return "tool would produce a destructive side effect in trial mode";
  }
  if (effect.scope === "external-network" || effect.scope === "operator-surface") {
    return "tool would produce a live external or operator-visible side effect in trial mode";
  }
  if (effect.scope === "daemon-state" && effect.kind !== "read") {
    return "tool would mutate daemon state outside the isolated trial project";
  }
  if (effect.scope === "process-env" && effect.kind !== "read") {
    return "tool would inject values into an execution environment in trial mode";
  }
  if (
    effect.scope === "local-fs" &&
    effect.kind !== "read" &&
    !opts.canScopeLocalFs
  ) {
    return `tool "${tool}" has local filesystem side effects that trial mode cannot root in the isolated project`;
  }
  return undefined;
}

function effectProjection(args: {
  id: string;
  description: string;
  source: ModuleManifestEffectSource;
  target: string;
  effect: ToolEffect;
  capabilityIds: readonly string[];
}): ModuleManifestEffectProjection {
  const reason = simulationBlockReasonFromEffect(args.target, args.effect, {
    canScopeLocalFs: false,
  });
  return {
    id: args.id,
    description: args.description,
    source: args.source,
    target: args.target,
    effect: args.effect,
    risk: riskFromEffect(args.effect),
    categories: effectCategoriesFromEffect(args.effect),
    capabilityIds: args.capabilityIds,
    simulation: reason
      ? { blocked: true, reason }
      : { blocked: false },
  };
}

function deriveSimulation(
  effects: readonly ModuleManifestEffectProjection[],
): ModuleManifestSimulation {
  const blockedReasons = unique(
    effects
      .map((effect) => effect.simulation.reason)
      .filter((reason): reason is string => reason !== undefined),
  );
  if (blockedReasons.length > 0) {
    return { support: "external-effects-blocked", blockedReasons };
  }
  const localMutation = effects.some((effect) =>
    effect.categories.includes("local-write") ||
    effect.categories.includes("session-write")
  );
  if (localMutation) return { support: "local-isolated", blockedReasons: [] };
  return { support: "full", blockedReasons: [] };
}

function validateSimulationCoversEffects(
  moduleName: string,
  simulation: ModuleManifestSimulation,
  effects: readonly ModuleManifestEffectProjection[],
): void {
  const blockedEffects = effects.filter((effect) => effect.simulation.blocked);
  if (blockedEffects.length === 0) {
    if (
      (simulation.support === "external-effects-blocked" ||
        simulation.support === "unsupported") &&
      simulation.blockedReasons.length === 0
    ) {
      throw new Error(
        `Module "${moduleName}" manifest simulation support "${simulation.support}" must declare blocked reasons`,
      );
    }
    return;
  }
  if (simulation.support === "full") {
    throw new Error(
      `Module "${moduleName}" manifest simulation support "full" conflicts with blocked effects: ${blockedEffects.map((effect) => effect.id).join(", ")}`,
    );
  }
  if (simulation.blockedReasons.length === 0) {
    throw new Error(
      `Module "${moduleName}" manifest simulation must declare blocked reasons for blocked effects: ${blockedEffects.map((effect) => effect.id).join(", ")}`,
    );
  }
}

function assertManifestRequiredForEffects(
  moduleName: string,
  effects: readonly ModuleManifestEffectProjection[],
): void {
  const uncovered = effects.filter((effect) =>
    effectRequiresExplicitManifest(effect.effect)
  );
  if (uncovered.length === 0) return;
  throw new Error(
    `Module "${moduleName}" must declare a manifest because it contributes external, operator-visible, or destructive effects: ${uncovered.map((effect) => effect.id).join(", ")}`,
  );
}

export function buildModuleManifestSetupStatusLinks(args: {
  moduleName: string;
  requirementId: string;
  kind: string;
  setupMode: ModuleManifestSetupMode;
}): ModuleManifestSetupStatusLinks {
  const moduleName = encodeURIComponent(args.moduleName);
  const requirementId = encodeURIComponent(args.requirementId);
  const base = `/setup/requirements/${moduleName}/${requirementId}`;
  return {
    list: "/setup/requirements",
    refresh: `${base}/refresh`,
    revoke: base,
    ...(args.setupMode === "form" ? { submitForm: `${base}/form` } : {}),
    ...(args.kind === "secret" || args.kind === "oauth" ? { storeSecret: `${base}/secret` } : {}),
    ...(args.setupMode === "url" ? { start: `${base}/start` } : {}),
  };
}

function projectSetupAvailability(
  status: ModuleSetupRequirementStatus,
): ModuleManifestSetupAvailabilitySnapshot {
  return {
    state: status.state,
    reason: status.reason,
    message: status.message,
    ...(status.capabilities !== undefined ? { capabilities: status.capabilities } : {}),
    ...(status.pendingAction !== undefined
      ? {
          pendingAction: {
            ...status.pendingAction,
            complete: `/setup/actions/${encodeURIComponent(status.pendingAction.actionId)}/complete`,
          },
        }
      : {}),
  };
}

export function projectSetupStatusOntoManifest(
  manifest: ModuleCapabilityManifestProjection,
  statuses: readonly ModuleSetupRequirementStatus[],
): ModuleCapabilityManifestProjection {
  const statusesByRequirement = new Map(
    statuses
      .filter((status) => status.moduleName === manifest.moduleName)
      .map((status) => [status.requirementId, status]),
  );
  return {
    ...manifest,
    contributions: {
      ...manifest.contributions,
      setupRequirements: manifest.contributions.setupRequirements.map((requirement) => {
        const status = statusesByRequirement.get(requirement.id);
        if (status === undefined) return requirement;
        return {
          ...requirement,
          availability: projectSetupAvailability(status),
        };
      }),
    },
  };
}

export function buildModuleCapabilityManifestProjection(
  moduleName: string,
  manifest: ModuleCapabilityManifestInput | undefined,
  snapshot: ModuleManifestContributionSnapshot,
): ModuleCapabilityManifestProjection {
  const capabilities = manifest?.capabilities ?? [inferredCapability(moduleName, snapshot)];
  const capabilityIds = manifest
    ? validateManifestInput(moduleName, manifest)
    : validateCapabilityIds(moduleName, capabilities);
  validateModuleEffectDeclarations(moduleName, snapshot.effects, capabilityIds);
  validateCapabilitySetupLinks(moduleName, capabilities, snapshot.setupRequirements);
  const defaultCapabilityIds = [...capabilityIds];
  const toolEffects = snapshot.tools.map((tool) =>
    effectProjection({
      id: `tool.${tool.name}`,
      description: tool.description,
      source: "tool",
      target: tool.name,
      effect: tool.effect,
      capabilityIds: defaultCapabilityIds,
    })
  );
  const moduleEffects = snapshot.effects.map((effect) =>
    effectProjection({
      id: effect.id,
      description: effect.description,
      source: effect.source,
      target: effect.id,
      effect: effect.effect,
      capabilityIds: effect.capabilityIds ?? defaultCapabilityIds,
    })
  );
  const additionalEffects = (manifest?.additionalEffects ?? []).map((effect) =>
    effectProjection({
      id: effect.id,
      description: effect.description,
      source: effect.source,
      target: effect.id,
      effect: effect.effect,
      capabilityIds: effect.capabilityIds,
    })
  );
  const effects = [...toolEffects, ...moduleEffects, ...additionalEffects];
  if (!manifest) assertManifestRequiredForEffects(moduleName, effects);
  const setupRequirementIds = snapshot.setupRequirements.map((req) => req.id);
  const healthCapabilityIds = unique(
    snapshot.setupRequirements.flatMap((req) => req.healthCapabilityIds),
  );
  const simulation = manifest?.simulation ?? deriveSimulation(effects);
  validateSimulationCoversEffects(moduleName, simulation, effects);
  return {
    schemaVersion: 1,
    moduleName,
    dependencies: snapshot.dependencies,
    capabilities,
    dataClasses: manifest?.dataClasses ?? [],
    contributions: {
      tools: snapshot.tools.map((tool) => tool.name),
      workflows: snapshot.workflows,
      workflowTriggers: snapshot.workflowTriggers,
      channels: snapshot.channels,
      skills: snapshot.skills,
      agents: snapshot.agents,
      commands: snapshot.commands,
      routes: snapshot.routes,
      controlRoutes: snapshot.controlRoutes,
      events: snapshot.events,
      eventFlows: snapshot.eventFlows,
      clients: {
        localNamespaces: snapshot.localClientNamespaces,
        daemonFactory: snapshot.hasDaemonClientFactory,
      },
      setupRequirements: snapshot.setupRequirements,
    },
    effects,
    simulation,
    readiness: {
      setupRequirementIds,
      healthCapabilityIds,
      healthCheck: snapshot.hasHealthCheck ? "declared" : "not-declared",
    },
  };
}
