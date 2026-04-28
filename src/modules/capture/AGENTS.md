# Capture Module

Cross-store capture seam — the symmetric write-side counterpart to the
recall/answer read-side seam. One natural-language note plus an optional
explicit target routes through one typed contributor into the right
store.

## What this module owns

- The `CaptureProvider` primitive and its single in-process implementation.
- The typed `CaptureContributor` protocol every store implements.
- The internal classifier prompt (`classifier-prompt.ts`) the seam asks
  when no `target` is supplied.
- One daemon-control route (`POST /capture`) plus its user-facing twin
  (`POST /api/capture`) — both share `createCaptureRouteHandler` so the
  wire shape cannot drift between operator surfaces.
- One `KotaClient.capture` namespace and one `kota capture <text>` CLI
  subcommand rendered through `src/modules/rendering`.

## How a new store joins

A new contributor:

1. Adds a literal to the `CaptureTarget` union and an arm to the
   `CaptureRecord` discriminated union in `src/core/server/kota-client.ts`.
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
- Classifier throws → treated as ambiguous. The seam logs the failure
  through the module's warn channel and surfaces `ambiguous`.
- Contributor throws → `contributor_failed` carries the target plus the
  error message verbatim.
- An explicit `target` is always honored regardless of classifier
  availability. This is the operator's manual override path.

## Boundaries

- No new persistence path. Each contributor delegates to its store's
  existing in-process writer (`MemoryProvider.save`,
  `KnowledgeProvider.create`, `createNormalizedTask`, an inbox
  `writeFileSync`). The seam never writes a parallel record on the side
  and never logs a separate envelope.
- No public classifier-prompt knob. Tuning the routing prompt lands as
  a focused follow-up, not as a per-call parameter.
- No cost surfacing into autonomy-facing context. The classifier uses
  the project's configured model client; per-call cost stays in the
  cost tracker the recall and answer seams already share.
- No fan-out from this module. Telegram, web, macOS, and mobile
  adoption land later as their own honest single-task follow-ups,
  matching the recall+answer pattern. The web client will consume
  `POST /api/capture` later through the same handler.
- No second registry, no second public capture path. `register()` is
  the single way new stores join.
