# Config Module

Owns the `kota config` CLI surface: `get`, `set`, `validate`, and `schema` subcommands.

- Config logic stays in `src/config.ts`; only the CLI wiring and HTTP routes live here.
- HTTP control routes mask sensitive requested paths, recursively mask
  secret-shaped fields, and mask every inline foreign-module environment
  value regardless of its variable name before returning resolved values.
  Filesystem-backed reads stay raw for intentional local CLI inspection; any
  other client-visible projection must apply the same core redaction policy.
- The module owns the `config` `KotaClient` namespace end-to-end. The
  namespace contract (`ConfigClient`, `ConfigValidateResult`,
  `ConfigGetResult`, `ConfigSetResult`) lives in `client.ts`. The
  daemon-side handler is built by `buildConfigDaemonHandler(link)` and
  contributed through the module's `daemonClient(link)` factory; the
  local-side handler is composed in `localClient(ctx)` from
  `config-operations.ts`.
