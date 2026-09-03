/**
 * Module-owned config slice contract.
 *
 * A `ModuleConfigSlice` lets a module own its top-level `.kota/config.json`
 * key end-to-end: the slice's TypeScript shape, sanitization, and merge
 * semantics all live in the owning module. Core walks the registered slices
 * during `loadConfig()` so adding a module's config field is a strictly
 * module-local edit.
 *
 * Modules contribute slices declaratively via `KotaModule.configSlices`.
 * Composition roots expose slices from identity-admitted declarations before
 * `loadConfig()`, and each loader borrows the same declaration through an
 * exact lifecycle lease.
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
 * `scopeConfigSafety` declares whether repo-owned scope-local config may
 * apply before the operator trusts the scope. Authority-changing is the
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
  scopeConfigSafety: "authority" | "safe";
  schemaSource: ModuleConfigSliceSchemaSource;
};

type ConfigSliceRegistration = {
  slice: ModuleConfigSlice;
  owner: string;
  structural: boolean;
  leases: Set<symbol>;
};

const _registrations = new Map<string, ConfigSliceRegistration>();

/**
 * Register a module-owned config slice structurally. Repeated registration is
 * idempotent for the same declaration. A re-imported declaration from the same
 * owner replaces the structural slice only while no loader host holds a lease.
 * The returned disposer rolls back this call when it changed the registration,
 * which lets discovery register a multi-slice declaration atomically.
 */
export function registerConfigSlice<K extends KotaModuleConfigKey>(
  slice: ModuleConfigSlice<K>,
  owner: string,
): () => void {
  const existing = _registrations.get(slice.key);
  if (existing) {
    const previousSlice = adoptCompatibleSlice(existing, slice, owner);
    if (existing.structural && previousSlice) {
      return replacementRegistrationDisposer(
        slice.key,
        existing,
        slice as ModuleConfigSlice,
        previousSlice,
      );
    }
    if (existing.structural) return () => {};
    existing.structural = true;
    return structuralRegistrationDisposer(slice.key, existing);
  }
  const registration: ConfigSliceRegistration = {
    slice: slice as ModuleConfigSlice,
    owner,
    structural: true,
    leases: new Set(),
  };
  _registrations.set(slice.key, registration);
  return structuralRegistrationDisposer(slice.key, registration);
}

/** Borrow a registered slice for one loader lifecycle. */
export function acquireConfigSlice<K extends KotaModuleConfigKey>(
  slice: ModuleConfigSlice<K>,
  owner: string,
): () => void {
  const existing = _registrations.get(slice.key);
  if (existing) adoptCompatibleSlice(existing, slice, owner);
  const registration = existing ?? {
    slice: slice as ModuleConfigSlice,
    owner,
    structural: false,
    leases: new Set<symbol>(),
  };
  if (!existing) _registrations.set(slice.key, registration);
  const lease = Symbol(`${owner}:${slice.key}`);
  registration.leases.add(lease);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = _registrations.get(slice.key);
    if (current !== registration) return;
    current.leases.delete(lease);
    if (!current.structural && current.leases.size === 0) {
      _registrations.delete(slice.key);
    }
  };
}

function adoptCompatibleSlice<K extends KotaModuleConfigKey>(
  existing: ConfigSliceRegistration,
  slice: ModuleConfigSlice<K>,
  owner: string,
): ModuleConfigSlice | undefined {
  if (existing.owner !== owner) {
    throw new Error(
      `Config key "${slice.key}" is already claimed by module "${existing.owner}"`,
    );
  }
  if (existing.slice === slice) return undefined;
  if (existing.leases.size > 0) {
    throw new Error(
      `Config key "${slice.key}" cannot change while module "${owner}" is loaded`,
    );
  }
  const previous = existing.slice;
  existing.slice = slice as ModuleConfigSlice;
  return previous;
}

function replacementRegistrationDisposer(
  key: string,
  registration: ConfigSliceRegistration,
  replacement: ModuleConfigSlice,
  previous: ModuleConfigSlice,
): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = _registrations.get(key);
    if (current === registration && current.slice === replacement) {
      current.slice = previous;
    }
  };
}

function structuralRegistrationDisposer(
  key: string,
  registration: ConfigSliceRegistration,
): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = _registrations.get(key);
    if (current !== registration) return;
    current.structural = false;
    if (current.leases.size === 0) _registrations.delete(key);
  };
}

/** Snapshot of the currently registered slices. */
export function getRegisteredConfigSlices(): readonly ModuleConfigSlice[] {
  return [..._registrations.values()].map(({ slice }) => slice);
}

/** Snapshot of the keys of currently registered slices. */
export function getRegisteredConfigSliceKeys(): ReadonlySet<string> {
  return new Set(_registrations.keys());
}

/** Look up a registered slice by key. */
export function getRegisteredConfigSlice(
  key: string,
): ModuleConfigSlice | undefined {
  return _registrations.get(key)?.slice;
}

/** Test helper: drop every registered slice. */
export function clearRegisteredConfigSlices(): void {
  _registrations.clear();
}
