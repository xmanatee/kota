# Recall Module

Cross-store recall seam. One natural-language query returns ranked,
source-tagged hits across every registered contributor.

## What this module owns

- The `RecallProvider` primitive and its single in-process implementation.
- The typed `RecallContributor` protocol every store implements.
- One daemon-control route (`POST /recall`) plus its user-facing twin
  (`POST /api/recall`) — both share `createRecallRouteHandler` so the wire
  shape cannot drift between operator surfaces.
- One `KotaClient.recall` namespace and one `kota recall <query>` CLI
  subcommand.
- One agent-callable tool (`recall`) contributed through the standard
  `KotaModule.tools` path. The tool wraps the same in-process
  `RecallProvider` and renders results through `renderRecallHitsPlain`,
  so a per-user agent session can pull cross-store context mid-
  conversation without an explicit `/recall` slash command.

## How a new store joins

A new contributor:

1. Adds a literal to the `RecallSource` union and an arm to the `RecallHit`
   discriminated union in `src/core/server/kota-client.ts`.
2. Adds a matching arm to `RawRecallEntry` in `recall-types.ts`.
3. Adds an adapter in `contributors.ts` that wraps its provider into a
   `RecallContributor`.
4. Registers the new contributor in this module's `onLoad`.

The `RecallProvider` itself enumerates contributors at runtime through its
`register()` API; nothing in core hard-codes the contributor set.

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
- No fan-out to other operator surfaces from this module — Telegram,
  macOS, and mobile adoption land later as their own follow-ups. The web
  client consumes `POST /api/recall` (same handler as `POST /recall`).
