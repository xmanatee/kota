/**
 * Module-owned config slice contract.
 *
 * A `ModuleConfigSlice` lets a module own its top-level `.kota/config.json`
 * key end-to-end: the slice's TypeScript shape, sanitization, and merge
 * semantics all live in the owning module. Core walks the registered slices
 * during `loadConfig()` so adding a module's config field is a strictly
 * module-local edit.
 *
 * Modules contribute slices declaratively via `KotaModule.configSlices`. The
 * loader and the dynamic-discovery layer both register declared slices in
 * the global registry so `loadConfig()` works whether modules are loaded
 * through `ModuleLoader.load()` or whether the CLI has only imported the
 * module's `index.ts` for command-discovery.
 *
 * The slice's TypeScript shape is wired into `KotaConfig` via declaration
 * merging on `KotaModuleConfigRegistry`: each owning module augments the
 * registry with its key/type pair, and `KotaConfig` intersects the registry
 * into its aggregate type.
 */

/**
 * Registry of module-owned config slice types. Owning modules augment this
 * interface with declaration merging:
 *
 *     declare module "#core/config/config-slice.js" {
 *       interface KotaModuleConfigRegistry {
 *         webhooks: Record<string, { secret: string }>;
 *       }
 *     }
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging surface
export interface KotaModuleConfigRegistry {}

export type KotaModuleConfigKey = keyof KotaModuleConfigRegistry & string;

/**
 * Build-time pointer that tells `build-schema.ts` which TypeScript type to
 * materialize into a JSON Schema fragment for the slice. The
 * `relativePath` is module-source relative to the repo root; the
 * `typeName` is the exported TS type name to feed to
 * `ts-json-schema-generator`.
 */
export type ModuleConfigSliceSchemaSource = {
  /** Repo-relative path to the source file declaring the slice's TypeScript type. */
  relativePath: string;
  /** Exported TS type name. */
  typeName: string;
};

/**
 * Strict slice contract. Each slice declares its key, a description used
 * by `kota config validate`, and typed sanitize/merge callbacks. No
 * optional fields: a slice that does not need merge semantics still
 * declares an explicit override-replaces-base merge.
 *
 * `projectConfigSafety` declares whether repo-owned project-local config may
 * apply before the operator trusts the project. Authority-changing is the
 * safe default for module slices: the owning module can narrow that only when
 * the slice cannot affect credentials, providers, process launch, routing,
 * guardrails, or autonomous runtime posture.
 *
 * `schemaSource` is consumed by `build-schema.ts` so the committed
 * `schema/kota-config.schema.json` can mirror the slice's TypeScript
 * shape end-to-end without core importing module types.
 */
export type ModuleConfigSlice<
  K extends KotaModuleConfigKey = KotaModuleConfigKey,
> = {
  key: K;
  description: string;
  sanitize(raw: unknown): KotaModuleConfigRegistry[K] | undefined;
  merge(
    base: KotaModuleConfigRegistry[K] | undefined,
    override: KotaModuleConfigRegistry[K],
  ): KotaModuleConfigRegistry[K];
  projectConfigSafety: "authority" | "safe";
  schemaSource: ModuleConfigSliceSchemaSource;
};

const _slices = new Map<string, ModuleConfigSlice>();
const _slicesByOwner = new Map<string, Set<string>>();

/**
 * Register a module-owned config slice. Idempotent for the same slice
 * object; rejects a second slice for an already-claimed key. Pass `owner`
 * (the module name) so unloads can deregister the slice.
 */
export function registerConfigSlice<K extends KotaModuleConfigKey>(
  slice: ModuleConfigSlice<K>,
  owner?: string,
): void {
  const existing = _slices.get(slice.key);
  if (existing) {
    if (existing === slice) {
      if (owner) addOwner(owner, slice.key);
      return;
    }
    throw new Error(
      `Module config slice "${slice.key}" already registered with a different definition`,
    );
  }
  _slices.set(slice.key, slice as ModuleConfigSlice);
  if (owner) addOwner(owner, slice.key);
}

function addOwner(owner: string, key: string): void {
  let keys = _slicesByOwner.get(owner);
  if (!keys) {
    keys = new Set();
    _slicesByOwner.set(owner, keys);
  }
  keys.add(key);
}

/**
 * Deregister all slices owned by `moduleName`. Called from the module
 * lifecycle when a module is unloaded.
 */
export function unregisterConfigSlicesForOwner(moduleName: string): void {
  const keys = _slicesByOwner.get(moduleName);
  if (!keys) return;
  for (const key of keys) _slices.delete(key);
  _slicesByOwner.delete(moduleName);
}

/** Snapshot of the currently registered slices. */
export function getRegisteredConfigSlices(): readonly ModuleConfigSlice[] {
  return [..._slices.values()];
}

/** Snapshot of the keys of currently registered slices. */
export function getRegisteredConfigSliceKeys(): ReadonlySet<string> {
  return new Set(_slices.keys());
}

/** Look up a registered slice by key. */
export function getRegisteredConfigSlice(
  key: string,
): ModuleConfigSlice | undefined {
  return _slices.get(key);
}

/** Test helper: drop every registered slice. */
export function clearRegisteredConfigSlices(): void {
  _slices.clear();
  _slicesByOwner.clear();
}
