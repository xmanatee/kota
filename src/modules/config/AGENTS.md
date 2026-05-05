# Config Module

Owns the `kota config` CLI surface: `get`, `set`, `validate`, and `schema` subcommands.

- Config logic stays in `src/config.ts`; only the CLI wiring and HTTP routes live here.
- The HTTP route masks sensitive keys before returning.
- The module owns the `config` `KotaClient` namespace end-to-end. The
  namespace contract (`ConfigClient`, `ConfigValidateResult`,
  `ConfigGetResult`, `ConfigSetResult`) lives in `client.ts`. The
  daemon-side handler is built by `buildConfigDaemonHandler(link)` and
  contributed through the module's `daemonClient(link)` factory; the
  local-side handler is composed in `localClient(ctx)` from
  `config-operations.ts`.
