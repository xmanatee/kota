# Config

Kernel-owned configuration and secrets management.

- `config.ts` — KOTA configuration schema, layered loading (global < project < overrides), and sanitization.
- `config-warnings.ts` — validation of unknown config keys and invalid concurrency settings.
- `secrets.ts` — secret store with provider-based resolution and output masking.
- `secret-providers.ts` — secret provider implementations (env file, JSON file, macOS keychain).

These are core primitives. Do not add module-specific configuration logic here.
