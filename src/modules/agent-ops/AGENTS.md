# Agent Ops Module

This module owns the reflective `kota agent` CLI surface.

- `index.ts` — `kota agent list` and `kota agent inspect` commands. It reflects agent definitions contributed by the currently loaded modules.

Keep this module read-only and reflective. It should inspect the loaded module set, not maintain a parallel agent catalog.
