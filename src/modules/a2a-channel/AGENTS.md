# A2A Channel

This module owns KOTA's Agent2Agent HTTP surface.

- Keep A2A Agent Card shape, JSON-RPC method decoding, SSE framing, and
  capability decisions inside this module.
- Treat every A2A HTTP body, header-derived value, task id, message part, and
  context id as external input. Decode it once at the boundary before calling
  daemon/session primitives.
- Route live work through the daemon `/sessions` control API. Do not read raw
  `.kota/` session files and do not add a parallel task queue, workflow
  engine, session store, agent registry, or MCP mirror.
- A2A task ids are KOTA daemon session ids. Any adapter memory must be
  transient request state only; durable task/session truth stays in the daemon.
- The public Agent Card must advertise only stable, non-sensitive capability
  metadata. Put token-bearing or deployment-sensitive details only behind
  bearer-protected `/api/a2a/*` routes.
- Advertise only implemented capabilities. Push notifications stay disabled
  until callback authentication, persistence, and unsubscribe behavior exist.
- Never expose internal reasoning traces, raw tool state, system prompts,
  workflow run internals, memory internals, or raw `.kota/` files through A2A.
