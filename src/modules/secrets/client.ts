/**
 * Secrets namespace client contract.
 *
 * The secrets module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/get/mutate types and the `SecretsClient`
 * interface that the `KotaClient` aggregate composes. Both the local-side
 * handler (`localClient(ctx)` in `index.ts`) and the daemon-side handler
 * (`daemonClient(link)` in `index.ts`) realize this contract; the
 * `kota secrets` CLI subcommands consume it through `ctx.client.secrets`
 * or by importing these types from `#modules/secrets/client.js`.
 */

/** A masked entry in the secret store (name and source only — never the value). */
export type SecretListEntry = {
  name: string;
  source: string;
};

export type SecretListResult = {
  secrets: SecretListEntry[];
};

/** Storage scope for a writable secret. Mirrors `SecretScope` in core/config/secrets. */
export type SecretScope = "project" | "global";

/** Result of `secrets.get(name)`. The contract is explicit about absence. */
export type SecretGetResult = { found: true; value: string } | { found: false };

/** Result of a writable secret operation (`set`, `remove`). */
export type SecretMutateResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "store_error"; message?: string };

/**
 * Secret-store operations.
 *
 * `list` returns names plus their resolution source — never the values.
 * `get` returns the resolved value when present, or an explicit `{ found:
 * false }` when absent. Mutation methods (`set`, `remove`) target a
 * specific writable scope; reading respects the provider chain regardless
 * of scope.
 */
export interface SecretsClient {
  list(): Promise<SecretListResult>;
  get(name: string): Promise<SecretGetResult>;
  set(name: string, value: string, scope: SecretScope): Promise<SecretMutateResult>;
  remove(name: string, scope: SecretScope): Promise<SecretMutateResult>;
}
