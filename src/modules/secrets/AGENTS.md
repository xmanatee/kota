# Secrets Module

This directory owns the `secrets` repo module — secure credential management with output masking.

- Registers `kota secrets set/get/list/remove` CLI commands.
- Registers the `get_secret` agent tool (injects secrets into env, returns placeholder to LLM — never exposes values to the model).
- Actual secret store implementation lives in `src/secrets.ts`.

