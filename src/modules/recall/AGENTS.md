# Recall Module

Cross-store recall seam. One natural-language query returns ranked,
source-tagged hits across every registered contributor — currently
`knowledge`, `memory`, `history`, `tasks`, and the `answer`-history
corpus contributed by the answer module.

## What this module owns

- The `RecallProvider` primitive and its single in-process implementation.
- The typed `RecallContributor` protocol every store implements.
- One daemon-control route (`POST /recall`) plus its user-facing twin
  (`POST /api/recall`) — both share `createRecallRouteHandler` so the wire
  shape cannot drift between operator surfaces.
- Both routes resolve a concrete scope id before provider execution. The
  provider passes a `RecallScopeContext` into contributors, so composed
  recall reads scope-scoped stores instead of module-global providers.
- One `KotaClient.recall` namespace and one `kota recall <query>` CLI
  subcommand.
- One agent-callable tool (`recall`) contributed through the standard
  `KotaModule.tools` path. The tool wraps the same in-process
  `RecallProvider` and renders results through `renderRecallHitsPlain`,
  so a per-user agent session can pull cross-store context mid-
  conversation without an explicit `/recall` slash command.
- The module-owned plain-text render helper is pinned with the cross-client
  recall render fixture in `clients/conformance/`. Web, mobile, and Apple
  tests consume the same fixture (or verified embedded copies), so changes to
  source labels, score precision, or per-source descriptions must update the
  fixture and every consuming surface together.
- One per-turn dynamic system-prompt contributor (entry point
  `buildRecallDynamicStateProvider` in `system-prompt.ts`, registered
  through `ctx.registerDynamicStateProvider` during `onLoad`). The block
  covers when to ground fact-shaped questions in knowledge, memory, and history before
  answering.

## How a new store joins

A new contributor — owned by whichever module owns the underlying store —
follows the same registration seam every other contributor uses:

1. Extends the recall source and hit unions in this module's `client.ts`;
   generated client bindings pick up the new arm from the canonical wire root.
2. Adds a matching arm to `RawRecallEntry` in `recall-types.ts`.
3. Builds a `RecallContributor` adapter wherever the store is owned.
4. From the owning module's `onLoad`, looks up the live `RecallProvider`
   through the provider-registry seam
   (`ctx.getProvider<RecallProvider>("recall")`) and calls
   `register(contributor)`. Declares `recall` in the module's
   `dependencies` so the loader populates the registry first.
5. From the same module activation's returned disposer, calls
   `recallProvider.unregister(<source>)` to withdraw the contributor.

The four first-party raw-store contributors (`knowledge`, `memory`,
`history`, `tasks`) live in `contributors.ts` because the recall module
already owns those stores. The `answer` contributor lives beside the rest
of the answer-history code in `src/modules/answer/recall-contributor.ts`
and is the worked example of the cross-module path: a module reaches the
live `RecallProvider` through the public registration seam from its own
`onLoad` and contributes a fifth source without the recall module gaining
an `answer` dependency.

The `RecallProvider` enumerates contributors at runtime through its
`register` / `unregister` API; nothing in core hard-codes the contributor
set, and adding a sixth contributor follows the same path.

## Score normalization rule

Contributors return their native scores (cosine for embedding-backed
contributors, weighted token count or rank-derived for keyword fallbacks).
The seam normalizes once via per-source min-max rescaling into `[0, 1]`,
merges every contributor's batch, sorts by normalized score, and tie-breaks
deterministically by `RECALL_SOURCE_ORDER` then id. The same query against
the same data returns the same ordering on every call.

## Degradation

A contributor that has no semantic backend falls back to its provider's
keyword search. A contributor that throws (e.g. embedding endpoint
unreachable) returns an empty batch — the seam logs once and continues with
the remaining contributors. The unified call never aborts because one store
cannot answer.

## Boundaries

- No new embedding plumbing, no new sidecar files, no new index format. The
  contributors delegate to each store's existing semantic-search interface.
- No replacement of the per-store query paths. `searchKnowledge`,
  `searchMemory`, `searchHistory`, and `searchTasks` remain as-is.
- New contributors that read scope data must consume the supplied scope
  context; global provider getters are only for the default-scope resolver.
- The recall module does not seed a parallel multi-surface fan-out chain
  by itself. Surface adoption (Telegram, Slack, macOS, mobile, web) lands
  as honest single-task follow-ups owned by the surface module. Each
  surface consumes the same `createRecallRouteHandler` envelope through
  `POST /api/recall` (visual clients) or `POST /recall` (other daemon
  clients via `KotaClient.recall.recall`).
