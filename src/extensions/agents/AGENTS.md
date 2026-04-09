# Agents Extension

This extension owns the `kota agent` CLI surface.

- `index.ts` — `kota agent list` and `kota agent inspect` commands. It reflects agent definitions contributed by the currently loaded extensions.

Keep this extension read-only and reflective. It should inspect the loaded extension set, not maintain an independent agent registry.
