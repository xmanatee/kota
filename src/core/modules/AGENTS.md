# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

- Keep modules as the single contribution boundary for tools, workflows,
  channels, providers, agents, and related runtime services.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system.
- Keep protocol details strict and code-owned. Message names, config fields,
  transport variants, health states, and generated scaffold details belong in
  types, schemas, examples, and focused tests instead of docs catalogs.
- CLI-only provider loading should activate the configured provider modules and
  their declared dependencies without loading unrelated module side effects.
