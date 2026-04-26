---
id: task-add-embedding-backed-semantic-search-to-conversati
title: Add embedding-backed semantic search to conversation history
status: done
priority: p2
area: modules
summary: Add a history-semantic module that wraps the conversation history store with embedding-backed search, mirroring memory-semantic and knowledge-semantic, so conversation_recall can rank by relevance instead of substring.
created_at: 2026-04-26T01:34:53.467Z
updated_at: 2026-04-26T01:49:56.436Z
---

## Problem

`conversation_recall` (the agent-facing tool that lets KOTA reach into past
sessions) ranks conversations by case-insensitive substring match against
title and message text. The implementation lives in
`src/modules/history/conversation-recall.ts` and `history.ts:list({
search })`. As soon as the user's history grows past a few weeks, "what
did we decide about X" no longer matches because the prior discussion uses
different words. The recall surface degrades silently — there is no
ranking, no synonym handling, no semantic match.

The repo already provides the right seam for this. `memory-semantic` and
`knowledge-semantic` each wrap their respective default store with a
SemanticStore that uses the shared `semantic-index` module's embedding
provider, cosine similarity, sidecar embeddings file, and lazy-fill
behavior, and register themselves as the provider via
`ctx.registerProvider(...)` when configured. The history store is the
same shape and has no equivalent module.

## Desired Outcome

A new `history-semantic` module wraps the default `ConversationHistory`
provider with embedding search. When the operator configures the embedding
provider, `conversation_recall` action `search` ranks results by semantic
relevance against title plus message text. Without that config, the
default keyword path is unchanged.

## Constraints

- Reuse the `semantic-index` module's embedding provider, cosine
  similarity, and lazy-fill behavior. Do not introduce a second embedding
  stack or a parallel cache file format.
- Sidecar embeddings file lives next to `history.json`; the canonical
  conversation files are not modified by indexing.
- Embedding writes happen on a background queue, never inline with a
  conversation write. A semantic write that fails must not corrupt or
  block the conversation write.
- Query-time embedding errors surface to the caller. Do not silently
  degrade to keyword search at query time — keyword search remains
  available through the default `history` provider when the semantic
  module is unconfigured.
- Without module config, the module is inactive: it does not register
  itself as the `history` provider, and keyword behavior on
  `conversation_recall` is identical to today.
- Reuse the existing tool. Do not add a second `conversation_recall_*`
  tool or a second action; ranking changes invisibly behind the
  provider seam.
- The `kota history` CLI gains a `reindex` subcommand that mirrors
  `kota memory reindex` / `kota knowledge reindex`. Do not invent a new
  CLI shape.
- Core must not import from `#modules/history-semantic/*`. Honor the
  repo-wide `no-module-imports-in-core` guard.

## Done When

- `src/modules/history-semantic/` exists with `index.ts`, a
  `SemanticHistoryStore` wrapping the file-based `ConversationHistory`,
  focused unit tests, and a local `AGENTS.md` describing the seam (the
  same shape as `memory-semantic/AGENTS.md`).
- The module registers itself as the `history` provider during `onLoad`
  when configured; otherwise it is inactive.
- `kota history reindex` populates the sidecar; first semantic query
  lazily fills entries that the sidecar is missing.
- A focused fixture-driven test exercises a query whose intent matches a
  past conversation under different wording: substring search misses,
  semantic search returns the relevant record at rank 1.
- The existing `memory-semantic` / `knowledge-semantic` AGENTS sentence
  on staleness and background-queue invariants is mirrored in the new
  module's `AGENTS.md` so the contract stays consistent across the
  three semantic modules.

## Source / Intent

Explorer 2026-04-26 noticed during repo inspection that `conversation_recall`
runs only substring matching while `memory-semantic` and
`knowledge-semantic` already provide the embedding seam. As history grows,
recall degrades; closing this gap aligns with the assistant-capability
trajectory and eliminates an asymmetry across the three primary stores.

## Initiative

KOTA personal-assistant capability — recall that holds up past months of
conversation. This is the third leg of the embedding-backed-store seam
(memory and knowledge already shipped) and prevents the asymmetry from
hardening into a permanent gap.

## Acceptance Evidence

- A live-run artifact under `.kota/runs/<run-id>/` containing two recall
  transcripts on the same fixture history — one with the keyword
  provider, one with the semantic provider — demonstrating that the
  semantic provider returns the relevant conversation while the keyword
  provider misses it.
- The focused test described in Done When is committed and exercises the
  same scenario deterministically.
