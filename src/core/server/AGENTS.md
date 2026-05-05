# Server

This directory owns the HTTP server layer plus the typed `KotaClient`
contract every CLI subcommand uses for daemon-or-local access.

## HTTP server scope

- Transport, session, and event-stream infrastructure live here.
- Capability-specific routes belong in the owning module and are
  contributed through `KotaModule.routes`.
- Do not read `.kota/` files to infer live daemon state when the daemon
  control API can provide it.
- Do not import server session-pool code back into daemon runtime code.

## KotaClient contract

`KotaClient` (in `kota-client.ts`) is the single typed surface CLI code
imports for daemon-or-local access. Two implementors realize it:

- `DaemonControlClient` — talks to a running daemon over the HTTP
  control API.
- `LocalKotaClient` — assembled from per-namespace local handlers
  registered by modules during load.

A single selector (`client-selector.ts`) resolves the active client once
per CLI invocation and stores it in `client-holder.ts`. CLI subcommands
read it through `ModuleContext.client` and never re-decide the
daemon-vs-local policy.

## Conventions

- The contract lives in `kota-client.ts` and grows by adding a typed
  namespace plus its declared name in `KOTA_CLIENT_NAMESPACES`.
- The owning module exposes its local handler through a top-level
  `localClient(ctx)` factory on its `KotaModule` definition, returning
  `{ <namespace>: handler }`. The loader always invokes this factory
  during module load — including the CLI's `commandsOnly` path — so
  handler registration does not depend on `onLoad`. The selector
  validates that every namespace has a registered handler when no daemon
  is reachable; missing handlers are a load-time failure with no silent
  fallback.
- The owning module exposes its daemon-side handler through a top-level
  `daemonClient(link)` factory on its `KotaModule` definition, symmetric
  with `localClient(ctx)`. The factory takes the resolved
  `DaemonTransport` (typed link from `daemon-transport.ts`) and returns
  `{ <namespace>: handler }`. The loader registers contributed factories
  during module load; the selector invokes them with the live transport
  and overlays the result on top of the core stub in `daemon-client.ts`.
  A namespace contributed by a module overrides the same namespace in
  the stub. As each namespace migrates to its owning module, its closure
  is removed from the core stub. Missing handlers (no contributor and no
  stub) fail loudly at construction.
- The owning module also contributes any HTTP routes the daemon-side
  client calls (under `KotaModule.routes`). Add routes to the same
  module that owns the underlying state.
- CLI subcommands consume `ctx.client.<namespace>.<method>()`. They must
  not import stores, run direct filesystem reads under `.kota/`, or
  resolve providers from `provider-registry` for capabilities the
  contract already covers.
- Existing daemon HTTP routes (`/api/memory`, `/api/tasks`, `/api/secrets`,
  approvals, workflow runs) are the daemon-side surface. Their request
  and response shapes are part of the public protocol.
- Bootstrap subcommands that legitimately must run before any client is
  resolved — `init`, `registry`, `completion`, `daemon-ops install` —
  are the explicit exception. They may read `.kota/` directly during
  setup. Document the exemption in the owning module's local AGENTS.md
  if a new bootstrap command is added.

## Adding a new namespace

1. Add the namespace interface to `kota-client.ts` and append its name
   to `KOTA_CLIENT_NAMESPACES`. Keep types small and explicit. Per-
   namespace request/response/options types live in `kota-client.ts` or
   the owning module — never in adjacent core-server files
   (`kota-client-namespace-types-guard.test.ts` enforces this).
2. Expose the daemon-side implementation through the owning module's
   top-level `daemonClient(link)` factory. Return
   `{ <namespace>: impl }`. The factory receives a typed
   `DaemonTransport`; reuse an existing HTTP route or contribute a new
   one from the owning module.
3. Expose the local-side implementation through the owning module's
   top-level `localClient(ctx)` factory. Return `{ <namespace>: impl }`.
4. Migrate the CLI subcommand to consume `ctx.client.<namespace>.<m>()`.

## Anti-patterns

- A second public client surface alongside `DaemonControlClient`.
- Per-subcommand "is daemon up?" checks that bypass the selector.
- Local handlers reaching back through HTTP to the same daemon they run
  inside.
- A namespace whose daemon-side and local-side return different data
  shapes — both implementors share one type per method.

## Non-namespace transport surface

`DaemonControlClient` may keep a non-namespace method only when every
condition holds:

- The caller already holds a `DaemonControlClient`, not a
  `DaemonTransport`. Module CLI code does not — it consumes
  `getDaemonTransport()` directly through `daemon-transport.ts` (the
  `kota-client-guard.test.ts` boundary check enforces this).
- No operator-facing CLI invokes the method. Anything reachable from
  `kota <subcommand>` must go through a `KotaClient` namespace so the
  daemon-up and daemon-down branches share one typed result.
- The daemon RPC has no natural namespace home, or wrapping it in a
  discriminated namespace result would distort the wire shape the
  caller needs (e.g. an SSE proxy or a dashboard payload that must
  re-emit the raw daemon body).

The current set is `registerSession`, `unregisterSession`,
`getDaemonStatus`, and `events()` — all consumed by the in-process
`kota serve` HTTP server when it bridges its sessions, status page,
and event stream to the running daemon. Adding a method here is a
"prove no namespace fits" decision, not a default. If a CLI ever
needs the same RPC, promote it to a `KotaClient` namespace and remove
the non-namespace method in the same change.
