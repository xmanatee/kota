import type {
  RiskTier,
  ToolEffect,
} from "#core/tools/effect.js";
import {
  assertManifestRequiredForEffects,
  buildModuleManifestEffectProjection,
  deriveModuleManifestSimulation,
  validateModuleManifestSimulation,
} from "./module-manifest-effects.js";
import type {
  ModuleSetupCapabilityStatus,
  ModuleSetupPendingAction,
  ModuleSetupStatusState,
} from "./setup-requirements.js";

export type ModuleManifestScope = "global" | "scope" | "daemon" | "external";
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
  | "scope-durable"
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
const MANIFEST_SCOPES = ["global", "scope", "daemon", "external"] as const;
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
  "scope-durable",
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
    buildModuleManifestEffectProjection({
      id: `tool.${tool.name}`,
      description: tool.description,
      source: "tool",
      target: tool.name,
      effect: tool.effect,
      capabilityIds: defaultCapabilityIds,
    })
  );
  const moduleEffects = snapshot.effects.map((effect) =>
    buildModuleManifestEffectProjection({
      id: effect.id,
      description: effect.description,
      source: effect.source,
      target: effect.id,
      effect: effect.effect,
      capabilityIds: effect.capabilityIds ?? defaultCapabilityIds,
    })
  );
  const additionalEffects = (manifest?.additionalEffects ?? []).map((effect) =>
    buildModuleManifestEffectProjection({
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
  const simulation = manifest?.simulation ?? deriveModuleManifestSimulation(effects);
  validateModuleManifestSimulation(moduleName, simulation, effects);
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

export {
  effectCategoriesFromEffect,
  simulationBlockReasonFromEffect,
} from "./module-manifest-effects.js";
export { buildModuleManifestEventFlows } from "./module-manifest-events.js";
export {
  buildModuleManifestSetupStatusLinks,
  scopeSetupStatusOntoManifest,
} from "./module-manifest-setup.js";
