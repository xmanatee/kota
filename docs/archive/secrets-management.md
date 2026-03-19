# Plan: Secrets Management

## Goal

KOTA needs a native secrets layer so the agent can use API keys, tokens, and credentials without them being hardcoded in `.env` files or shell env. The layer should be pluggable — support OS keychain natively, and allow external providers (1Password, Vault, Doppler, etc.) via the same interface.

## Why

- Currently secrets are just env vars — plaintext, no scoping, no masking
- The agent can read `.env` files and leak secrets into LLM context
- No way to scope secrets per-project vs global
- No masking in agent output — secrets can appear in tool results, logs, conversation

## Requirements

### 1. Secret Provider Interface
A simple abstraction that any backend implements:
- Get a secret by name
- List available secret names (not values)
- Scoping: global (user-level) vs project-level

### 2. Built-in Providers
- **Env vars** — read from `process.env` and `.env` files (what exists today, but formalized)
- **OS Keychain** — macOS Keychain, Linux Secret Service, Windows Credential Manager. Use `cross-keychain` npm package (actively maintained, native bindings)

### 3. External Provider Support
The interface should be simple enough that external providers can be added as modules/plugins:
- 1Password (`op` CLI or `@1password/sdk`)
- Doppler (`doppler run`)
- HashiCorp Vault
- Infisical
- AWS Secrets Manager

### 4. Provider Chain
Try providers in priority order until a secret is found. Default chain: project env → global env → keychain. Users can configure the chain and add external providers.

### 5. Output Masking
Secret values must be masked in all agent output — tool results, logs, transport events. Any string matching a known secret value gets replaced with `<secret:name>` before reaching the LLM context or user display. This is critical for agent safety.

### 6. Secret Scoping
- **Global** — user-level secrets (API keys that work everywhere)
- **Project** — per-directory secrets (project-specific tokens)
- **Session** — ephemeral secrets that don't persist (nice-to-have)

### 7. CLI Commands
- `kota secrets set <name>` — store a secret (prompts for value, never in argv)
- `kota secrets get <name>` — retrieve and display
- `kota secrets list` — show names (not values)
- `kota secrets remove <name>`
- `--global` / `--project` flag for scoping

### 8. Agent Access
The agent should be able to retrieve secrets via a tool (e.g., `get_secret`) but the tool should:
- Only return the secret value to the tool execution layer, not to the LLM context
- Inject it into the environment for shell/code_exec tools
- The LLM sees `<secret:name>` placeholder, the runtime resolves it

## Landscape Reference

How others do it:
- **OpenHands**: Best agent-native design. `SecretRegistry` with masking in all outputs, callable providers for rotation, secrets never in LLM context
- **Devin**: 3-tier scoping (org > repo > session). Dashboard-managed, injected into sandbox
- **Continue.dev**: Org secrets never leave server (proxy model). User secrets loaded at startup
- **Cursor**: Built-in encrypted secrets UI, KMS at rest
- **1Password**: `op run` injects env vars for subprocess only — secrets never touch disk. `op inject` for config templates
- **Doppler/Infisical**: `doppler run -- command` pattern — wrap process with injected env vars

## What This Plan Does NOT Include

- Secret rotation (can be added via callable providers later)
- Team/org-level secrets (single-user tool for now)
- Encryption at rest beyond what the OS keychain provides
- Secret sharing between KOTA instances
