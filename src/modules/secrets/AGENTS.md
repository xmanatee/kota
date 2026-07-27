# Secrets Module

This directory owns the `secrets` repo module — secure credential management with output masking.

- Registers `kota secrets set/get/list/remove` CLI commands.
- Registers the `get_secret` agent tool (injects secrets into a live session- and project-local execution environment, returns a placeholder to the LLM, and erases the overlay at session teardown).
- Resolves every client, route, and tool operation through a validated project selector; unknown projects fail before store access.
- The project-store registry and provider chain live in `src/core/config/secrets.ts`.
