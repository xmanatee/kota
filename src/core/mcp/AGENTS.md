# MCP

This directory contains Model Context Protocol client/server/manager integration.

- Keep protocol boundaries clean and host-neutral.
- Changes here should preserve clear separation between KOTA internals and MCP transport concerns.
- Treat MCP as a transport over KOTA capabilities, not a second capability
  registry. Tools, resources, prompts, sampling, roots, and elicitation must
  remain adapters around existing runtime contracts.
- Exact MCP methods, resource identifiers, prompt names, capability flags, and
  payload shapes belong in source, protocol tests, and generated client-facing
  behavior. Do not maintain a parallel catalog in `docs/`.
