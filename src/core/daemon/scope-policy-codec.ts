import {
  assertKeys,
  type ScopePolicyBoundaryObject as BoundaryObject,
  type ScopePolicyBoundaryValue as BoundaryValue,
  enumArray,
  fail,
  objectValue,
  optionalEnum,
  optionalObject,
  positiveInteger,
  requiredEnum,
  requiredString,
  stringArray,
} from "./scope-policy-codec-values.js";
import type {
  ScopeActionPolicy,
  ScopeAutonomyPolicyFragment,
  ScopeChannelRoutingPolicyFragment,
  ScopeExternalEffectPolicyFragment,
  ScopeModuleAvailability,
  ScopeModulePolicyFragment,
  ScopeOwnerConfirmationPolicyFragment,
  ScopePolicyArea,
  ScopePolicyFragment,
  ScopeRetentionPolicy,
  ScopeSetupVisibility,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";

export type ScopePolicyDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const AREAS = [
  "autonomy",
  "writes",
  "channels",
  "setup",
  "ownerConfirmation",
  "retention",
  "modules",
  "externalEffects",
] as const satisfies readonly ScopePolicyArea[];
const ACTIONS = ["allow", "confirm", "deny"] as const;
const AUTONOMY_MODES = ["passive", "supervised", "autonomous"] as const;
const SETUP_VISIBILITIES = ["hidden", "metadata", "full"] as const;
const MODULE_AVAILABILITIES = ["enabled", "setup-required", "disabled"] as const;
const REDACTIONS = ["full", "sensitive-fields", "none"] as const;

export function decodeScopePolicyFragments(
  raw: BoundaryValue,
): ScopePolicyDecodeResult<readonly ScopePolicyFragment[]> {
  try {
    if (!Array.isArray(raw)) fail("scopePolicies must be an array");
    const value = raw.map((entry, index) => parseFragment(entry, `scopePolicies[${index}]`));
    const scopeIds = value.map((entry) => entry.scopeId);
    if (new Set(scopeIds).size !== scopeIds.length) {
      fail("scopePolicies must not contain duplicate scopeId entries");
    }
    return {
      ok: true,
      value,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function decodeScopePolicyFragment(
  raw: BoundaryValue,
): ScopePolicyDecodeResult<ScopePolicyFragment> {
  try {
    return { ok: true, value: parseFragment(raw, "policy") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseFragment(raw: BoundaryValue, path: string): ScopePolicyFragment {
  const obj = objectValue(raw, path);
  assertKeys(obj, path, [
    "scopeId",
    "reason",
    "allowChildWidening",
    "autonomy",
    "writes",
    "channels",
    "setup",
    "ownerConfirmation",
    "retention",
    "modules",
    "externalEffects",
  ]);
  const scopeId = requiredString(obj.scopeId, `${path}.scopeId`);
  const reason = requiredString(obj.reason, `${path}.reason`);
  const allowChildWidening = obj.allowChildWidening === undefined
    ? undefined
    : enumArray(obj.allowChildWidening, `${path}.allowChildWidening`, AREAS);
  const autonomy = optionalObject(obj.autonomy, `${path}.autonomy`, parseAutonomy);
  const writes = obj.writes === undefined
    ? undefined
    : parseWrites(obj.writes, `${path}.writes`);
  const channels = optionalObject(obj.channels, `${path}.channels`, parseChannels);
  const setup = optionalObject(obj.setup, `${path}.setup`, parseSetup);
  const ownerConfirmation = optionalObject(
    obj.ownerConfirmation,
    `${path}.ownerConfirmation`,
    parseOwnerConfirmation,
  );
  const retention = obj.retention === undefined
    ? undefined
    : parseRetention(obj.retention, `${path}.retention`);
  const modules = optionalObject(obj.modules, `${path}.modules`, parseModules);
  const externalEffects = optionalObject(
    obj.externalEffects,
    `${path}.externalEffects`,
    parseExternalEffects,
  );
  return {
    scopeId,
    reason,
    ...(allowChildWidening !== undefined ? { allowChildWidening } : {}),
    ...(autonomy !== undefined ? { autonomy } : {}),
    ...(writes !== undefined ? { writes } : {}),
    ...(channels !== undefined ? { channels } : {}),
    ...(setup !== undefined ? { setup } : {}),
    ...(ownerConfirmation !== undefined ? { ownerConfirmation } : {}),
    ...(retention !== undefined ? { retention } : {}),
    ...(modules !== undefined ? { modules } : {}),
    ...(externalEffects !== undefined ? { externalEffects } : {}),
  };
}

function parseAutonomy(obj: BoundaryObject, path: string): ScopeAutonomyPolicyFragment {
  assertKeys(obj, path, ["defaultMode", "maxMode"]);
  const defaultMode = optionalEnum(obj.defaultMode, `${path}.defaultMode`, AUTONOMY_MODES);
  const maxMode = optionalEnum(obj.maxMode, `${path}.maxMode`, AUTONOMY_MODES);
  if (
    defaultMode !== undefined &&
    maxMode !== undefined &&
    AUTONOMY_MODES.indexOf(defaultMode) > AUTONOMY_MODES.indexOf(maxMode)
  ) fail(`${path}.defaultMode cannot exceed maxMode`);
  return {
    ...(defaultMode !== undefined ? { defaultMode } : {}),
    ...(maxMode !== undefined ? { maxMode } : {}),
  };
}

function parseWrites(raw: BoundaryValue, path: string): ScopeWriteBoundary {
  const obj = objectValue(raw, path);
  assertKeys(obj, path, ["mode", "paths"]);
  const mode = requiredEnum(obj.mode, `${path}.mode`, [
    "none",
    "scope-directory",
    "paths",
    "unrestricted",
  ] as const);
  if (mode === "paths") {
    return { mode, paths: stringArray(obj.paths, `${path}.paths`) };
  }
  if (obj.paths !== undefined) fail(`${path}.paths is only valid when mode is paths`);
  return { mode };
}

function parseChannels(obj: BoundaryObject, path: string): ScopeChannelRoutingPolicyFragment {
  assertKeys(obj, path, ["mode", "allowedChannels", "blockedSources", "ignoredSources"]);
  const mode = optionalEnum(obj.mode, `${path}.mode`, ["blocked", "allow-list", "allow-all"] as const);
  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(obj.allowedChannels !== undefined
      ? { allowedChannels: stringArray(obj.allowedChannels, `${path}.allowedChannels`) }
      : {}),
    ...(obj.blockedSources !== undefined
      ? { blockedSources: stringArray(obj.blockedSources, `${path}.blockedSources`) }
      : {}),
    ...(obj.ignoredSources !== undefined
      ? { ignoredSources: stringArray(obj.ignoredSources, `${path}.ignoredSources`) }
      : {}),
  };
}

function parseSetup(
  obj: BoundaryObject,
  path: string,
): { visibility?: ScopeSetupVisibility } {
  assertKeys(obj, path, ["visibility"]);
  const visibility = optionalEnum(obj.visibility, `${path}.visibility`, SETUP_VISIBILITIES);
  return visibility === undefined ? {} : { visibility };
}

function parseOwnerConfirmation(
  obj: BoundaryObject,
  path: string,
): ScopeOwnerConfirmationPolicyFragment {
  assertKeys(obj, path, ["localWrite", "externalWrite", "destructive"]);
  return actionFields(obj, path, ["localWrite", "externalWrite", "destructive"]);
}

function parseExternalEffects(
  obj: BoundaryObject,
  path: string,
): ScopeExternalEffectPolicyFragment {
  assertKeys(obj, path, ["networkRead", "networkWrite", "networkDestructive"]);
  return actionFields(obj, path, ["networkRead", "networkWrite", "networkDestructive"]);
}

function actionFields<TName extends string>(
  obj: BoundaryObject,
  path: string,
  names: readonly TName[],
): Partial<Record<TName, ScopeActionPolicy>> {
  const out: Partial<Record<TName, ScopeActionPolicy>> = {};
  for (const name of names) {
    const value = optionalEnum(obj[name], `${path}.${name}`, ACTIONS);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function parseRetention(raw: BoundaryValue, path: string): ScopeRetentionPolicy {
  const obj = objectValue(raw, path);
  assertKeys(obj, path, ["mode", "maxAgeDays", "redaction"]);
  const mode = requiredEnum(obj.mode, `${path}.mode`, ["retain", "expire-after-days"] as const);
  const redaction = requiredEnum(obj.redaction, `${path}.redaction`, REDACTIONS);
  if (mode === "retain") {
    if (obj.maxAgeDays !== undefined) fail(`${path}.maxAgeDays is not valid for retain mode`);
    return { mode, redaction };
  }
  const maxAgeDays = positiveInteger(obj.maxAgeDays, `${path}.maxAgeDays`);
  return { mode, maxAgeDays, redaction };
}

function parseModules(obj: BoundaryObject, path: string): ScopeModulePolicyFragment {
  assertKeys(obj, path, ["defaultAvailability", "overrides"]);
  const defaultAvailability = optionalEnum(
    obj.defaultAvailability,
    `${path}.defaultAvailability`,
    MODULE_AVAILABILITIES,
  );
  const overrides = obj.overrides === undefined
    ? undefined
    : moduleOverrides(obj.overrides, `${path}.overrides`);
  return {
    ...(defaultAvailability !== undefined ? { defaultAvailability } : {}),
    ...(overrides !== undefined ? { overrides } : {}),
  };
}

function moduleOverrides(
  raw: BoundaryValue,
  path: string,
): Array<{ moduleName: string; availability: ScopeModuleAvailability }> {
  if (!Array.isArray(raw)) fail(`${path} must be an array`);
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const obj = objectValue(entry, itemPath);
    assertKeys(obj, itemPath, ["moduleName", "availability"]);
    const moduleName = requiredString(obj.moduleName, `${itemPath}.moduleName`);
    if (seen.has(moduleName)) fail(`${path} repeats moduleName ${moduleName}`);
    seen.add(moduleName);
    return {
      moduleName,
      availability: requiredEnum(
        obj.availability,
        `${itemPath}.availability`,
        MODULE_AVAILABILITIES,
      ),
    };
  });
}
