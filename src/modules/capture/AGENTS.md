# Capture Module

Cross-store capture seam — the symmetric write-side counterpart to the
recall/answer read-side seam. One natural-language note plus an optional
explicit target routes through one typed contributor into the right
store.

The symmetric correction surface is `src/modules/retract/` —
`RetractProvider`, `kota retract`, `POST /retract`, the `retract` agent
tool, and the matching priming block. Capture writes; retract removes
or supersedes a prior record. The two seams share the same target list
and are independently registered.

## What this module owns

- The `CaptureProvider` primitive and its single in-process implementation.
- The typed `CaptureContributor` protocol every store implements.
- The internal classifier prompt (`classifier-prompt.ts`) the seam asks
  when no `target` is supplied.
- One daemon-control route (`POST /capture`) plus its user-facing twin
  (`POST /api/capture`) — both share `createCaptureRouteHandler` so the
  wire shape cannot drift between operator surfaces.
- Both routes resolve a concrete scope id before writer execution. Scope
  contributors receive `CaptureScopeContext` and write through that
  scope's stores and scope root.
- One `KotaClient.capture` namespace and one `kota capture <text>` CLI
  subcommand rendered through `src/modules/rendering`.
- One agent-callable tool (`capture`) contributed through the standard
  `KotaModule.tools` path. The tool wraps the same in-process
  `CaptureProvider` the CLI / daemon route / KotaClient share, so a
  per-user agent session running in any channel can route a noteworthy
  chat-resident fact through the same classifier and contributor
  registry without an explicit `/capture` slash command. The runner
  reuses `renderCaptureResultPlain` so the tool transcript matches the
  slash-command surface byte-for-byte.
- One per-turn dynamic system-prompt contributor (entry point
  `buildCaptureDynamicStateProvider` in `system-prompt.ts`, registered
  through `ctx.registerDynamicStateProvider` during `onLoad`). The block
  covers when to capture a chat-resident fact without waiting for an
  explicit `/capture` command.

## How a new store joins

A new contributor:

1. Extends the capture target and record unions in
   `src/core/server/kota-client.ts`.
2. Adds an adapter in `contributors.ts` that wraps its writer into a
   `CaptureContributor`.
3. Registers the new contributor in this module's `onLoad`.
4. Extends the per-target description list in `classifier-prompt.ts` so
   the classifier can disambiguate the new store from existing ones.

The `CaptureProvider` itself enumerates contributors at runtime through
its `register()` API; nothing in core hard-codes the contributor set.

## Routing rules

- `target` set → dispatch verbatim to that contributor. The classifier
  is not consulted.
- `target` unset, classifier present → call the classifier with the
  trimmed text, the optional hint, and the registered contributor list.
  A confident pick is dispatched; an `AMBIGUOUS` reply (or any unknown
  reply) surfaces the `ambiguous` envelope.
- `target` unset, classifier unavailable (model client not registered or
  the call throws) → surface `ambiguous` immediately. The seam never
  guesses.

## Strict envelope contract

`CaptureResult` is one of:

- `{ ok: true; record: CaptureRecord }` — the contributor minted a
  record. `record` is discriminated by `target`; per-target arms carry
  the typed identifier (memory id, knowledge slug, task id, inbox file
  slug) plus any path metadata.
- `{ ok: false; reason: "ambiguous"; suggestions }` — no `target` and
  classification could not pick one. `suggestions` lists the registered
  contributors so the surface can re-issue with `--target`.
- `{ ok: false; reason: "no_contributors" }` — the seam itself is
  unconfigured (zero contributors registered, or the explicit `target`
  is not registered).
- `{ ok: false; reason: "contributor_failed"; target; message }` — the
  chosen contributor threw. The seam never silently retries into a
  different store.

## Degradation rules

- Empty / whitespace-only text → `ambiguous` with the full suggestions
  list. The seam refuses to ship an empty record into any store.
- Classifier throws → the production default classifier wrapper
  (`createDefaultClassifier` in `index.ts`) catches its own
  `createModelClient` and `messages.create` throws inside two `try/catch`
  blocks, logs through the module's warn channel, and returns
  `{ kind: "ambiguous" }`. The underlying `CaptureProviderImpl.capture`
  does not catch classifier exceptions itself; a custom
  `CaptureClassifier` handed to the seam that does NOT wrap its own
  throws will surface as a 500 at the route boundary. The wrapper layer
  is where the "treat as ambiguous" guarantee lives.
- Contributor throws → `contributor_failed` carries the target plus the
  error message verbatim.
- An explicit `target` is always honored regardless of classifier
  availability. This is the operator's manual override path.

## Boundaries

- No new persistence path. Each contributor delegates to its store's
  existing in-process writer (`MemoryProvider.save`,
  `KnowledgeProvider.create`, `createNormalizedTask`, or the repo-tasks
  domain's verified inbox writer). The seam never writes a parallel record on
  the side and never logs a separate envelope.
- Scope contributors must use the supplied scope context; default
  provider getters are not a valid path for multi-scope capture.
- No public classifier-prompt knob. Tuning the routing prompt lands as
  a focused follow-up, not as a per-call parameter.
- No cost surfacing into autonomy-facing context. The classifier uses
  the scope's configured model client; per-call cost stays in the
  cost tracker the recall and answer seams already share.
- Live operator consumers are the daemon `POST /capture` route, the
  web-facing `POST /api/capture` route, `kota capture <text>`, the web
  shared-UI capture surface through `KotaClient.capture`, mobile
  `CaptureScreen`, macOS `CaptureExpandedContent` via
  `DaemonClient.capture`, Telegram `/capture` plus the four
  `/capture-to-{memory,knowledge,tasks,inbox}` commands, and
  Slack-channel `/capture` plus the same four explicit-target commands.
  These surfaces share `createCaptureRouteHandler`,
  `renderCaptureResultPlain`, `renderCaptureReplyPlain`, and the
  conformance fixture instead of maintaining independent wire contracts.
- No second registry, no second public capture path. `register()` is
  the single way new stores join.
