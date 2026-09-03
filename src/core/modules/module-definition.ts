import { Command } from "commander";
import { assertAgentHarnessDefinitions } from "#core/agent-harness/harness-definition.js";
import { assertKotaToolInputSchema } from "#core/agent-harness/message-protocol.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import {
  type AgentDef,
  assertAgentDefinitions,
  assertSkillDefinitions,
  type SkillDef,
} from "#core/agents/agent-types.js";
import { assertChannelDefinitions, type ChannelDef } from "#core/channels/channel.js";
import type { ModuleConfigSlice } from "#core/config/config-slice.js";
import type { ModuleEventDef } from "#core/events/module-event.js";
import { validateModuleEventDeclaration } from "#core/events/module-event-schema.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { DaemonClientHandlers, LocalClientHandlers } from "#root/client/kota-client.generated.js";
import type {
  ModuleContext,
  ModuleContribution,
  ModuleRuntimeContext,
  ModuleWorkflowContribution,
} from "./module-context-types.js";
import type {
  ModuleCapabilityManifestInput,
  ModuleManifestEffectDeclaration,
} from "./module-manifest.js";
import type {
  ControlRouteRegistration,
  HealthCheckResult,
  ModuleBoundaryRecord,
  ModuleHealth,
  RouteRegistration,
  ToolDef,
} from "./module-types.js";
import type { UiSurfaceSource } from "./module-ui-surfaces.js";
import {
  type ModuleSetupRequirement,
  validateModuleSetupRequirements,
} from "./setup-requirements.js";

/** Host-owned runtime instance returned by module activation. */
export type ModuleActivation = {
  dispose: () => Promise<void> | void;
};

/** The single declaration boundary for every project or installed module. */
export type KotaModule = {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  configSlices?: readonly ModuleConfigSlice[];
  configSchema?: ModuleBoundaryRecord;
  events?: ReadonlyArray<ModuleEventDef>;
  tools?: ToolDef[] | ((ctx: ModuleContext) => ToolDef[]);
  commands?: (ctx: ModuleContext) => Command[];
  routes?: (ctx: ModuleContext) => RouteRegistration[];
  controlRoutes?: (ctx: ModuleContext) => ControlRouteRegistration[];
  workflows?: ModuleContribution<ModuleWorkflowContribution>;
  channels?: ModuleContribution<ChannelDef>;

  /** Side-effect-free sources projected live through the canonical assembler. */
  uiSurfaces?: ModuleContribution<UiSurfaceSource>;

  skills?: ModuleContribution<SkillDef>;
  agents?: ModuleContribution<AgentDef>;
  agentHarnesses?: ModuleContribution<AgentHarness>;
  effects?: ModuleContribution<ModuleManifestEffectDeclaration>;
  setupRequirements?: ModuleContribution<ModuleSetupRequirement>;
  manifest?:
    | ModuleCapabilityManifestInput
    | ((ctx: ModuleContext) => ModuleCapabilityManifestInput);
  localClient?: (ctx: ModuleContext) => Partial<LocalClientHandlers>;
  daemonClient?: (link: DaemonTransport) => Partial<DaemonClientHandlers>;
  onLoad?: (
    ctx: ModuleRuntimeContext,
  ) => Promise<ModuleActivation | void> | ModuleActivation | void;
  getHealth?: () => ModuleHealth;
  healthCheck?: () => HealthCheckResult | Promise<HealthCheckResult>;
};

const MODULE_DEFINITION_KEYS = new Set<keyof KotaModule>([
  "name",
  "version",
  "description",
  "dependencies",
  "configSlices",
  "configSchema",
  "events",
  "tools",
  "commands",
  "routes",
  "controlRoutes",
  "workflows",
  "channels",
  "uiSurfaces",
  "skills",
  "agents",
  "agentHarnesses",
  "effects",
  "setupRequirements",
  "manifest",
  "localClient",
  "daemonClient",
  "onLoad",
  "getHealth",
  "healthCheck",
]);

const MODULE_ARRAY_FIELDS = [
  "configSlices",
  "events",
] as const satisfies readonly (keyof KotaModule)[];

const MODULE_CONTRIBUTION_FIELDS = [
  "tools",
  "workflows",
  "channels",
  "uiSurfaces",
  "skills",
  "agents",
  "agentHarnesses",
  "effects",
  "setupRequirements",
] as const satisfies readonly (keyof KotaModule)[];

const MODULE_FACTORY_FIELDS = [
  "commands",
  "routes",
  "controlRoutes",
  "localClient",
  "daemonClient",
  "onLoad",
  "getHealth",
  "healthCheck",
] as const satisfies readonly (keyof KotaModule)[];

function moduleDeclarationError(detail: string): Error {
  return new Error(`Invalid module declaration: ${detail}`);
}

type ContributionField = typeof MODULE_CONTRIBUTION_FIELDS[number];

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function assertKnownFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} has unknown field "${key}"`);
  }
}

function assertToolEffect(value: unknown, label: string): void {
  assertRecord(value, label);
  assertKnownFields(value, new Set(["kind", "scope", "idempotent", "openWorld"]), label);
  if (!["read", "write", "destructive"].includes(value.kind as string)) {
    throw new Error(`${label}.kind is invalid`);
  }
  if (!["session", "local-fs", "daemon-state", "process-env", "external-network", "operator-surface"]
    .includes(value.scope as string)) {
    throw new Error(`${label}.scope is invalid`);
  }
  if (typeof value.idempotent !== "boolean" || typeof value.openWorld !== "boolean") {
    throw new Error(`${label}.idempotent and .openWorld must be booleans`);
  }
}

function assertConfigSliceDefinitions(moduleName: string, values: readonly unknown[]): void {
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" configSlice[${index}]`;
    assertRecord(value, label);
    assertKnownFields(
      value,
      new Set(["key", "description", "sanitize", "merge", "scopeConfigSafety", "schemaSource"]),
      label,
    );
    assertNonEmptyString(value.key, `${label}.key`);
    assertNonEmptyString(value.description, `${label}.description`);
    if (typeof value.sanitize !== "function" || typeof value.merge !== "function") {
      throw new Error(`${label}.sanitize and .merge must be functions`);
    }
    if (value.scopeConfigSafety !== "authority" && value.scopeConfigSafety !== "safe") {
      throw new Error(`${label}.scopeConfigSafety must be "authority" or "safe"`);
    }
    assertRecord(value.schemaSource, `${label}.schemaSource`);
    assertKnownFields(
      value.schemaSource,
      new Set(["relativePath", "typeName"]),
      `${label}.schemaSource`,
    );
    assertNonEmptyString(value.schemaSource.relativePath, `${label}.schemaSource.relativePath`);
    assertNonEmptyString(value.schemaSource.typeName, `${label}.schemaSource.typeName`);
  }
}

function assertEventDefinitions(moduleName: string, values: readonly unknown[]): void {
  const sensitivities = new Set(["public", "internal", "sensitive", "secret"]);
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" event[${index}]`;
    assertRecord(value, label);
    assertKnownFields(
      value,
      new Set([
        "name",
        "fields",
        "scope",
        "schema",
        "filterablePaths",
        "sensitivity",
        "compatibility",
        "workflowTriggerPolicy",
        "examples",
        "normalizeExternal",
        "__payload",
      ]),
      label,
    );
    if (value.scope !== "scope" && value.scope !== "daemon") {
      throw new Error(`${label}.scope must be "scope" or "daemon"`);
    }
    validateModuleEventDeclaration(
      value.name,
      value.fields,
      value.schema,
      value.filterablePaths,
    );
    if (!Array.isArray(value.examples)) throw new Error(`${label}.examples must be an array`);
    if (typeof value.sensitivity !== "string" || !sensitivities.has(value.sensitivity)) {
      throw new Error(`${label}.sensitivity is invalid`);
    }
    if (value.compatibility !== "none" && value.compatibility !== "backward") {
      throw new Error(`${label}.compatibility must be "none" or "backward"`);
    }
    if (value.workflowTriggerPolicy !== "allowed" && value.workflowTriggerPolicy !== "blocked") {
      throw new Error(`${label}.workflowTriggerPolicy must be "allowed" or "blocked"`);
    }
    if (value.normalizeExternal !== undefined && typeof value.normalizeExternal !== "function") {
      throw new Error(`${label}.normalizeExternal must be a function when declared`);
    }
    if (value.__payload !== undefined && typeof value.__payload !== "function") {
      throw new Error(`${label}.__payload must be a function when declared`);
    }
    for (const [exampleIndex, example] of value.examples.entries()) {
      const exampleLabel = `${label}.examples[${exampleIndex}]`;
      assertRecord(example, exampleLabel);
      assertKnownFields(example, new Set(["name", "payload"]), exampleLabel);
      assertNonEmptyString(example.name, `${exampleLabel}.name`);
      assertRecord(example.payload, `${exampleLabel}.payload`);
    }
  }
}

function assertToolObjectSchema(value: unknown, label: string): void {
  assertKotaToolInputSchema(value, label);
}

function assertToolDefinitions(moduleName: string, values: readonly unknown[]): void {
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" tool[${index}]`;
    assertRecord(value, label);
    assertKnownFields(value, new Set(["tool", "runner", "group", "effect", "resolveEffect"]), label);
    assertRecord(value.tool, `${label}.tool`);
    assertKnownFields(
      value.tool,
      new Set(["name", "description", "input_schema", "output_schema"]),
      `${label}.tool`,
    );
    assertNonEmptyString(value.tool.name, `${label}.tool.name`);
    if (typeof value.tool.description !== "string") {
      throw new Error(`${label}.tool.description must be a string`);
    }
    assertToolObjectSchema(value.tool.input_schema, `${label}.tool.input_schema`);
    if (value.tool.output_schema !== undefined) {
      assertToolObjectSchema(value.tool.output_schema, `${label}.tool.output_schema`);
    }
    if (typeof value.runner !== "function") throw new Error(`${label}.runner must be a function`);
    if (value.group !== undefined) assertNonEmptyString(value.group, `${label}.group`);
    if (value.resolveEffect !== undefined && typeof value.resolveEffect !== "function") {
      throw new Error(`${label}.resolveEffect must be a function when declared`);
    }
    if (value.effect === undefined) {
      throw new Error(
        `Module "${moduleName}" tool "${value.tool.name}" missing required metadata: effect`,
      );
    }
    assertToolEffect(value.effect, `${label}.effect`);
  }
}

function assertUiSurfaceDefinitions(moduleName: string, values: readonly unknown[]): void {
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" uiSurface[${index}]`;
    assertRecord(value, label);
    assertKnownFields(value, new Set(["sourceId", "scope"]), label);
    assertNonEmptyString(value.sourceId, `${label}.sourceId`);
    if (typeof value.scope !== "function") throw new Error(`${label}.scope must be a function`);
  }
}

function assertEffectDefinitions(moduleName: string, values: readonly unknown[]): void {
  const sources = new Set([
    "tool",
    "channel",
    "route",
    "control-route",
    "workflow",
    "client",
    "lifecycle",
    "notification",
  ]);
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" effect[${index}]`;
    assertRecord(value, label);
    assertKnownFields(
      value,
      new Set(["id", "description", "source", "effect", "capabilityIds"]),
      label,
    );
    assertNonEmptyString(value.id, `${label}.id`);
    assertNonEmptyString(value.description, `${label}.description`);
    if (typeof value.source !== "string" || !sources.has(value.source)) {
      throw new Error(`${label}.source is invalid`);
    }
    assertToolEffect(value.effect, `${label}.effect`);
    if (value.capabilityIds !== undefined) {
      if (!Array.isArray(value.capabilityIds)) {
        throw new Error(`${label}.capabilityIds must be an array when declared`);
      }
      for (const id of value.capabilityIds) {
        assertNonEmptyString(id, `${label}.capabilityIds entry`);
      }
    }
  }
}

function assertContributionItems(
  moduleName: string,
  field: ContributionField,
  values: readonly unknown[],
): void {
  try {
    switch (field) {
      case "tools":
        assertToolDefinitions(moduleName, values);
        break;
      case "workflows":
        // Workflow contents are decoded by the canonical workflow validator
        // after the loader has attached module path/source metadata.
        break;
      case "channels":
        assertChannelDefinitions(moduleName, values);
        break;
      case "skills":
        assertSkillDefinitions(moduleName, values);
        break;
      case "agents":
        assertAgentDefinitions(moduleName, values);
        break;
      case "agentHarnesses":
        assertAgentHarnessDefinitions(moduleName, values);
        break;
      case "uiSurfaces":
        assertUiSurfaceDefinitions(moduleName, values);
        break;
      case "effects":
        assertEffectDefinitions(moduleName, values);
        break;
      case "setupRequirements":
        validateModuleSetupRequirements(moduleName, values as readonly ModuleSetupRequirement[]);
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw moduleDeclarationError(message);
  }
}

/** Decode a runtime-loaded module before dependency sorting or host activation. */
export function assertModuleDefinition(value: unknown): asserts value is KotaModule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw moduleDeclarationError("expected an object");
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MODULE_DEFINITION_KEYS.has(key as keyof KotaModule)) {
      throw moduleDeclarationError(`unknown field "${key}"`);
    }
  }

  if (typeof record.name !== "string" || record.name.trim() !== record.name || record.name.length === 0) {
    throw moduleDeclarationError('field "name" must be a non-empty trimmed string');
  }
  for (const field of ["version", "description"] as const) {
    const fieldValue = record[field];
    if (fieldValue !== undefined && (typeof fieldValue !== "string" || fieldValue.trim().length === 0)) {
      throw moduleDeclarationError(`field "${field}" must be a non-empty string when declared`);
    }
  }

  const dependencies = record.dependencies;
  if (dependencies !== undefined) {
    if (!Array.isArray(dependencies) || dependencies.some((dependency) =>
      typeof dependency !== "string" || dependency.trim() !== dependency || dependency.length === 0)) {
      throw moduleDeclarationError('field "dependencies" must contain non-empty trimmed strings');
    }
    if (new Set(dependencies).size !== dependencies.length) {
      throw moduleDeclarationError('field "dependencies" must not contain duplicates');
    }
    if (dependencies.includes(record.name)) {
      throw moduleDeclarationError(`module "${record.name}" cannot depend on itself`);
    }
  }

  for (const field of MODULE_ARRAY_FIELDS) {
    if (record[field] !== undefined && !Array.isArray(record[field])) {
      throw moduleDeclarationError(`field "${field}" must be an array when declared`);
    }
  }
  try {
    if (Array.isArray(record.configSlices)) {
      assertConfigSliceDefinitions(record.name, record.configSlices);
    }
    if (Array.isArray(record.events)) assertEventDefinitions(record.name, record.events);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw moduleDeclarationError(message);
  }
  for (const field of MODULE_CONTRIBUTION_FIELDS) {
    const contribution = record[field];
    if (contribution !== undefined && !Array.isArray(contribution) && typeof contribution !== "function") {
      throw moduleDeclarationError(`field "${field}" must be an array or factory when declared`);
    }
    if (Array.isArray(contribution)) {
      assertContributionItems(record.name, field, contribution);
    }
  }
  for (const field of MODULE_FACTORY_FIELDS) {
    if (record[field] !== undefined && typeof record[field] !== "function") {
      throw moduleDeclarationError(`field "${field}" must be a function when declared`);
    }
  }

  const configSchema = record.configSchema;
  if (configSchema !== undefined) {
    try {
      assertKotaToolInputSchema(configSchema, `Module "${record.name}" configSchema`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw moduleDeclarationError(message);
    }
  }
  const manifest = record.manifest;
  if (manifest !== undefined && typeof manifest !== "function" &&
    (typeof manifest !== "object" || manifest === null || Array.isArray(manifest))) {
    throw moduleDeclarationError('field "manifest" must be an object or factory when declared');
  }
}

export function resolveModuleTools(
  mod: KotaModule,
  ctx?: ModuleContext,
): ToolDef[] {
  if (!mod.tools) return [];
  let tools: ToolDef[];
  if (typeof mod.tools === "function") {
    if (!ctx) {
      throw new Error(`Module "${mod.name}" has tools factory but no context provided`);
    }
    tools = mod.tools(ctx);
  } else {
    tools = mod.tools;
  }
  if (!Array.isArray(tools)) {
    throw moduleDeclarationError(`Module "${mod.name}" tools factory must return an array`);
  }
  assertContributionItems(mod.name, "tools", tools);
  return tools;
}

async function resolveContribution<T>(
  moduleName: string,
  field: ContributionField,
  value: ModuleContribution<T> | undefined,
  ctx: ModuleContext,
): Promise<readonly T[]> {
  if (!value) return [];
  const resolved = typeof value === "function" ? await value(ctx) : value;
  if (!Array.isArray(resolved)) {
    throw moduleDeclarationError(
      `Module "${moduleName}" ${field} factory must return an array`,
    );
  }
  assertContributionItems(moduleName, field, resolved);
  return resolved;
}

export function resolveModuleWorkflows(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleWorkflowContribution[]> {
  return resolveContribution(mod.name, "workflows", mod.workflows, ctx);
}

export function resolveModuleChannels(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ChannelDef[]> {
  return resolveContribution(mod.name, "channels", mod.channels, ctx);
}

export function resolveModuleUiSurfaceSources(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly UiSurfaceSource[]> {
  return resolveContribution(mod.name, "uiSurfaces", mod.uiSurfaces, ctx);
}

export function resolveModuleSkills(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly SkillDef[]> {
  return resolveContribution(mod.name, "skills", mod.skills, ctx);
}

export function resolveModuleAgents(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly AgentDef[]> {
  return resolveContribution(mod.name, "agents", mod.agents, ctx);
}

export function resolveModuleAgentHarnesses(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly AgentHarness[]> {
  return resolveContribution(mod.name, "agentHarnesses", mod.agentHarnesses, ctx);
}

export function resolveModuleEffects(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleManifestEffectDeclaration[]> {
  return resolveContribution(mod.name, "effects", mod.effects, ctx);
}

export function resolveModuleSetupRequirements(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleSetupRequirement[]> {
  return resolveContribution(mod.name, "setupRequirements", mod.setupRequirements, ctx);
}

export function assertModuleCommandFactoryResult(
  moduleName: string,
  value: unknown,
): asserts value is Command[] {
  if (!Array.isArray(value)) {
    throw moduleDeclarationError(`Module "${moduleName}" commands factory must return an array`);
  }
  for (const [index, command] of value.entries()) {
    if (!(command instanceof Command)) {
      throw moduleDeclarationError(
        `Module "${moduleName}" command[${index}] must be a Commander Command`,
      );
    }
  }
}

const MODULE_ROUTE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MODULE_ROUTE_KEYS = new Set([
  "method",
  "path",
  "bypassAuth",
  "authFailureHandler",
  "handler",
]);
const MODULE_CONTROL_ROUTE_KEYS = new Set([
  ...MODULE_ROUTE_KEYS,
  "capabilityScope",
]);

function assertRouteFactoryResult(
  moduleName: string,
  field: "routes" | "controlRoutes",
  value: unknown,
): asserts value is RouteRegistration[] | ControlRouteRegistration[] {
  if (!Array.isArray(value)) {
    throw moduleDeclarationError(`Module "${moduleName}" ${field} factory must return an array`);
  }
  for (const [index, route] of value.entries()) {
    const label = `Module "${moduleName}" ${field}[${index}]`;
    try {
      assertRecord(route, label);
      const allowedKeys =
        field === "controlRoutes" ? MODULE_CONTROL_ROUTE_KEYS : MODULE_ROUTE_KEYS;
      for (const key of Object.keys(route)) {
        if (!allowedKeys.has(key)) {
          throw new Error(`${label} has unknown field "${key}"`);
        }
      }
      if (typeof route.method !== "string" || !MODULE_ROUTE_METHODS.has(route.method)) {
        throw new Error(`${label}.method is invalid`);
      }
      assertNonEmptyString(route.path, `${label}.path`);
      if (!route.path.startsWith("/")) {
        throw new Error(`${label}.path must start with "/"`);
      }
      if (typeof route.handler !== "function") {
        throw new Error(`${label}.handler must be a function`);
      }
      if (route.bypassAuth !== undefined && typeof route.bypassAuth !== "boolean") {
        throw new Error(`${label}.bypassAuth must be a boolean when declared`);
      }
      if (
        route.authFailureHandler !== undefined &&
        typeof route.authFailureHandler !== "function"
      ) {
        throw new Error(`${label}.authFailureHandler must be a function when declared`);
      }
      if (
        field === "controlRoutes" &&
        route.capabilityScope !== "read" &&
        route.capabilityScope !== "control"
      ) {
        throw new Error(`${label}.capabilityScope must be "read" or "control"`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw moduleDeclarationError(message);
    }
  }
}

export function assertModuleRouteFactoryResult(
  moduleName: string,
  value: unknown,
): asserts value is RouteRegistration[] {
  assertRouteFactoryResult(moduleName, "routes", value);
}

export function assertModuleControlRouteFactoryResult(
  moduleName: string,
  value: unknown,
): asserts value is ControlRouteRegistration[] {
  assertRouteFactoryResult(moduleName, "controlRoutes", value);
}

export function assertModuleActivation(
  moduleName: string,
  value: unknown,
): asserts value is ModuleActivation {
  try {
    assertRecord(value, `Module "${moduleName}" onLoad result`);
    if (typeof value.dispose !== "function") {
      throw new Error(`Module "${moduleName}" onLoad result.dispose must be a function`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw moduleDeclarationError(message);
  }
}
