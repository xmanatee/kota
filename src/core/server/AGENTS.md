# Server

This directory owns the HTTP server layer for sessions, daemon control, event
streams, and server-side notifications.

- Keep transport and session infrastructure here.
- Capability-specific routes belong in the owning module and are contributed
  through `KotaModule.routes`.
- Do not read `.kota/` files to infer live daemon state when the daemon control
  API can provide it.
- Do not import server session-pool code back into daemon runtime code.
