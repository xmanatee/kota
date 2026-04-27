---
id: task-add-a-unified-cross-store-recall-seam-returning-ra
title: Add a unified cross-store recall seam returning ranked semantic hits across knowledge, memory, history, and repo tasks in one query
status: done
priority: p2
area: architecture
summary: Introduce a single cross-store recall seam that takes one natural-language query and returns ranked, source-tagged semantic hits from knowledge, memory, history, and repo-tasks at once, so KOTA can answer 'what do I know / remember / have done / am tracking about X?' without forcing the operator to pick a store.
created_at: 2026-04-27T07:08:44.656Z
updated_at: 2026-04-27T07:26:32.832Z
---

## Problem

KOTA now ships embedding-backed semantic search for four stores —
`knowledge`, `memory`, `history`, and `repo-tasks` — each with its own
`searchKnowledge` / `searchMemory` / `searchHistory` / `searchTasks`
namespace, daemon route, CLI subcommand, Telegram command, macOS view,
and mobile screen. The operator surface has therefore reached four
parallel, store-scoped query paths: to recall something the operator
must already know which store it lives in. That is the inverse of how a
"second brain" personal assistant should work — `recall("graphrag
benchmarks")` should not require the operator to first decide whether
the answer is more likely a saved knowledge entry, a working-memory
note, a past conversation, or an open task.

There is no shared cross-store query primitive today. Adding one ad-hoc
on top of the four namespaces would mean every consumer (CLI, channels,
clients) re-implements its own fan-out + ranking logic, which is the
exact churn the recent fan-out cycle just produced four times. The next
natural product capability is a single typed seam: one query in, one
ranked list of hits out, each hit tagged with its source store.

## Desired Outcome

- A single typed `RecallProvider` (or equivalent) primitive lives in one
  owning module and takes a natural-language query plus optional filters
  (max hits, score floor, source-store filter) and returns ranked,
  source-tagged hits from every contributing store in one call.
- The seam delegates to each store's existing semantic-search interface
  (`searchKnowledge`, `searchMemory`, `searchHistory`, `searchTasks`).
  No new embedding plumbing, no new sidecar files, no new index format.
- Hits are merged into a single ranked list using a normalized score
  (e.g. unit-cosine), with stable tie-breaking and a typed
  `RecallHit` discriminated by `source: "knowledge" | "memory" |
  "history" | "tasks"` carrying the per-store payload (id, title or
  preview, timestamps, score). Adding a fifth store later means
  registering a fifth contributor against the same primitive, not
  editing every consumer.
- The seam exposes itself to the daemon via one HTTP route and one
  `KotaClient` namespace, and demonstrates end-to-end through one
  operator-facing surface (the CLI `kota recall` subcommand). Other
  surfaces (Telegram, macOS, mobile, web) intentionally land later as
  their own follow-ups so this task ships the *seam*, not another
  five-surface fan-out chain.
- Behavior degrades cleanly when a contributing store does not support
  semantic search: the seam falls back to that store's keyword search
  (or skips it) without breaking the unified call.

## Constraints

- One mechanism. The cross-store seam contributes through the existing
  module/provider model — no parallel "recall" registry, no second
  semantic-index manager, no second embedding cache.
- The owning module declares its dependencies on the four stores
  through the standard `KotaModule.dependencies` array. Module loader
  validates contribution order; the seam does not reach across module
  boundaries directly.
- Module discovery only — do not hard-code the four store names in
  core. The seam should accept N typed contributors so adding a fifth
  store is a registration, not an enum edit.
- Score normalization is explicit at the seam, not at each contributor.
  Contributors return their native scores; the seam normalizes once.
- Strict typed protocols: `RecallHit` is a discriminated union by
  `source`, no nullable score, no optional payload fields that admit
  illegal combinations. Filters are typed; missing inputs use explicit
  defaults at the seam, not silent fallbacks.
- The seam preserves each store's existing per-store query path. The
  `searchKnowledge` / `searchMemory` / `searchHistory` / `searchTasks`
  namespaces stay as-is — `recall` is additive, not a replacement.
- One daemon HTTP route, one KotaClient namespace, one CLI subcommand
  in this task. Channel and client fan-out is explicitly out of scope
  here; do not pre-emptively seed Telegram / macOS / mobile / web
  follow-ups in the same run.
- No legacy or compatibility shim. The seam launches as the only
  cross-store recall path.

## Done When

- A new module (e.g. `src/modules/recall/`) owns the `RecallProvider`
  primitive, the cross-store dispatch, normalized ranking, and the
  `RecallHit` discriminated union. Module declares `knowledge`,
  `memory`, `history`, `repo-tasks`, and `semantic-index` as runtime
  dependencies as appropriate.
- Each contributing store registers a typed `RecallContributor`
  (or equivalent) through the normal module-context surface. The
  primitive enumerates contributors at runtime; no hard-coded list of
  four stores.
- `RecallProvider.recall(query, filters?)` returns a single ranked
  list of `RecallHit` values within budget on a representative
  fixture, with stable tie-breaking and explicit normalized scoring.
- Daemon exposes one HTTP route (e.g. `POST /api/recall`) backed by
  the seam, and `KotaClient.recall.recall(query, filters?)` reaches
  it from both daemon-up and daemon-down code paths via the existing
  `localClient` / daemon-link composer.
- `kota recall <query>` CLI subcommand exists in the owning module's
  `cli.ts` and renders results through `src/modules/rendering` with
  source-tagged rows. `--json` keeps the structured output path.
- Tests cover: (a) unit behavior of the merge/normalize/rank step
  against a synthetic fixture mixing all four stores, (b) graceful
  degradation when a contributor returns zero hits or an embedding
  failure, (c) HTTP route round-trip with discriminated response,
  (d) CLI rendered output and `--json` parity.
- The owning module's `AGENTS.md` describes the seam at the
  conventions level — what the primitive does, how a new store
  registers, the normalization contract — without enumerating per-
  store wire details.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-27T07-04-42-456Z-explorer-d59wgb/` after the
final macOS+mobile fan-out for `searchTasks` landed (commit
`18ba6edf`). The four-store semantic-search fan-out is the dominant
recent autonomy cycle (51 surface tasks since the seam work began),
and the next product capability — "one query, one ranked list across
my whole second brain" — does not yet exist. The owner-direction
signal pointing this way is the earlier task-search fan-out itself:
once every store has its own retrieval surface, the missing piece is
the unified retrieval surface that does not force the operator to
pre-classify their question.

## Initiative

Personal-assistant retrieval: KOTA should answer one operator query
across every store it owns, in one ranked, source-tagged result,
without making the operator pre-decide which store the answer lives
in. This task lands the seam; surface adoption (Telegram, macOS,
mobile, web) lands later as honest single-task follow-ups, not as
parallel five-surface fan-out chains seeded all at once.

## Acceptance Evidence

- Diff covering the new owning module, the typed `RecallProvider`
  primitive, contributor registration through each store, the daemon
  HTTP route, the `KotaClient.recall` namespace, and the
  `kota recall` CLI subcommand.
- Unit tests for the merge/normalize/rank step against a synthetic
  fixture, including degradation cases.
- HTTP-level tests proving daemon-up and daemon-down parity for the
  `recall` namespace.
- A captured CLI transcript under the run directory showing
  `kota recall <query>` returning ranked hits from at least three of
  the four stores (rendered output + `--json` payload), with
  source tags visible.
- Module's `AGENTS.md` documenting the contributor contract and the
  normalization rule.
