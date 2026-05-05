/**
 * Config namespace client contract.
 *
 * The config module owns the `config` KotaClient namespace surface end-to-end:
 * this file declares the result types and the `ConfigClient` interface that
 * the `KotaClient` aggregate composes. The local-side handler in `index.ts`
 * (backed by `config-operations.ts`) and the daemon-side handler
 * (`buildConfigDaemonHandler` factory in `index.ts`) realize this contract.
 */

/**
 * Resolved-config snapshot returned by `config.validate`.
 *
 * `sources` carries the project + global config file paths the resolver
 * read (the global path is omitted when not present). `warnings` carries
 * unknown-key diagnostics (one warning per key the resolver did not
 * recognize given the loaded module set's contributed config keys). The
 * `resolved` payload is the same merged config shape `loadConfig` returns;
 * the contract types it as a plain JSON record because the CLI only ever
 * round-trips it for rendering.
 */
export type ConfigValidateResult = {
  sources: { label: "global" | "project"; path: string }[];
  warnings: string[];
  resolved: Record<string, unknown>;
};

/**
 * Result of `config.get(key)`.
 *
 * `key` is dot-notation (`a.b.c`) into the resolved merged config.
 * Returns `not_found` instead of `undefined` so the CLI can render a
 * clear diagnostic without ambiguity between "missing" and "explicit
 * null". The value is the matched leaf (string, number, object, etc.)
 * surfaced verbatim for the caller to JSON-stringify or unwrap.
 */
export type ConfigGetResult =
  | { found: true; value: unknown }
  | { found: false; reason: "not_found" };

/**
 * Result of `config.set(key, value)`.
 *
 * `unknownKey: true` flags writes to a top-level key that the loaded
 * module set did not declare; the operation still persists (the CLI
 * surfaces the warning and continues), matching the existing CLI
 * behavior. `value` is the parsed value the writer persisted —
 * typically the JSON-parsed result of the input string, falling back
 * to the literal string when JSON parsing fails.
 */
export type ConfigSetResult = {
  ok: true;
  unknownKey: boolean;
  topKey: string;
  value: unknown;
};

/**
 * Configuration operations.
 *
 * `validate` returns the resolved merged config plus diagnostics about
 * unknown keys; `get` resolves a dot-notation key path; `set` persists
 * a single key into the project-level `.kota/config.json`. The schema
 * file path is exposed by `schemaPath()` so the CLI can avoid building
 * its own URL math; the daemon-side handler reflects the daemon's
 * shipped schema and the local handler reflects the CLI's, but both
 * point at the same file in normal installs.
 */
export interface ConfigClient {
  validate(): Promise<ConfigValidateResult>;
  get(key: string): Promise<ConfigGetResult>;
  set(key: string, rawValue: string): Promise<ConfigSetResult>;
  schemaPath(): Promise<{ path: string }>;
  schemaContent(): Promise<{ content: string }>;
}
