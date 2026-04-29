/**
 * Typed provider tokens for the module provider registry.
 *
 * A `ProviderToken<T>` is a branded string id that ties a stable provider
 * identifier to the TypeScript type its consumers expect. Tokens replace
 * the previous `(type: string, provider: unknown)` shape on
 * `ProviderRegistry`, `ModuleContext.registerProvider`, and
 * `ModuleContext.getProvider` so a misspelled id, a mismatched provider
 * shape, or a wrong-type `getProvider` consumer is caught at compile time.
 *
 * Tokens are invariant in their value type. The phantom `__providerToken`
 * field carries `(value: T) => T`, which makes `ProviderToken<A>` and
 * `ProviderToken<B>` mutually unassignable when `A !== B` even when both
 * carry the same id at runtime.
 *
 * Tokens remain plain strings at runtime: the registry continues to key
 * its internal map by `token` (a branded string), and existing string
 * literals on the wire (e.g. `"memory"`, `"capability-readiness"`) are
 * preserved. Modules can declare their own tokens locally; cross-cutting
 * core providers declare theirs alongside the value type.
 */

declare const providerTokenBrand: unique symbol;

/**
 * Branded string id paired with the provider value type. Plain string
 * literals are not assignable to `ProviderToken<T>` because they lack the
 * brand; the brand is invariant in `T` so a token for one provider type is
 * not assignable to a token for a different provider type.
 */
export type ProviderToken<T> = string & {
  readonly [providerTokenBrand]: (value: T) => T;
};

/**
 * Define a provider token for a value type. Use this once at the type's
 * source of truth (core for cross-cutting providers, the owning module for
 * module-domain providers) and import the token at every call site.
 */
export function defineProviderToken<T>(id: string): ProviderToken<T> {
  return id as ProviderToken<T>;
}
