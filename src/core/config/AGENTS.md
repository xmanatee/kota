# Config

Kernel-owned configuration and secrets management.

- `config.ts` — KOTA configuration schema, layered loading (global < project < overrides), and sanitization.
- `config-warnings.ts` — validation of unknown config keys and invalid concurrency settings.
- `project-dir.ts` — single source of truth for resolving the project directory
  the daemon and operator CLI act on. Operator surfaces that need a project
  root must go through `resolveProjectDir` rather than reaching for
  `process.cwd()` directly, so the `KOTA_PROJECT_DIR` env var and the
  `--project-dir` CLI flag are honored consistently.
- `secrets.ts` — secret store with provider-based resolution and output masking.
- `secret-providers.ts` — secret provider implementations (env file, JSON file, macOS keychain).

These are core primitives. Do not add module-specific configuration logic here.
Config fields, defaults, and enum values are code-owned contracts. Keep the
TypeScript schema, JSON Schema generation, warnings, and focused tests as the
source of truth instead of maintaining a parallel prose catalog.
