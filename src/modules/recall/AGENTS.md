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
- Both routes resolve a concrete project id before provider execution. The
  provider passes a `RecallProjectContext` into contributors, so composed
  recall reads project-scoped stores instead of module-global providers.
- One `KotaClient.recall` namespace and one `kota recall <query>` CLI
  subcommand.
- One agent-callable tool (`recall`) contributed through the standard
  `KotaModule.tools` path. The tool wraps the same in-process
  `RecallProvider` and renders results through `renderRecallHitsPlain`,
  so a per-user agent session can pull cross-store context mid-
  conversation without an explicit `/recall` slash command.
- One per-turn dynamic system-prompt contributor (entry point
  `buildRecallDynamicStateProvider` in `system-prompt.ts`, registered
  through `ctx.registerDynamicStateProvider` during `onLoad`). The
  contributor emits the conversational-pattern block when the session's
  effective tool policy admits `recall`, and the empty string otherwise
  — so a session that cannot call the tool never sees instructions that
  reference it. Tool descriptions cover shape; this block covers the
  conversational trigger so the agent grounds fact-shaped questions in
  the second brain before answering.

## How a new store joins

A new contributor — owned by whichever module owns the underlying store —
follows the same registration seam every other contributor uses:

1. Adds a literal to the `RecallSource` union and an arm to the `RecallHit`
   discriminated union in `src/core/server/kota-client.ts`.
2. Adds a matching arm to `RawRecallEntry` in `recall-types.ts`.
3. Builds a `RecallContributor` adapter wherever the store is owned.
4. From the owning module's `onLoad`, looks up the live `RecallProvider`
   through the provider-registry seam
   (`ctx.getProvider<RecallProvider>("recall")`) and calls
   `register(contributor)`. Declares `recall` in the module's
   `dependencies` so the loader populates the registry first.
5. From the same module's `onUnload`, calls
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
- New contributors that read project data must consume the supplied project
  context; global provider getters are only for the default-project resolver.
- The recall module does not seed a parallel multi-surface fan-out chain
  by itself. Surface adoption (Telegram, Slack, macOS, mobile, web) lands
  as honest single-task follow-ups owned by the surface module. Each
  surface consumes the same `createRecallRouteHandler` envelope through
  `POST /api/recall` (visual clients) or `POST /recall` (other daemon
  clients via `KotaClient.recall.recall`).
