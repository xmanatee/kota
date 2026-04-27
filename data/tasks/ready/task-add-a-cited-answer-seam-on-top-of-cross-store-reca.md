---
id: task-add-a-cited-answer-seam-on-top-of-cross-store-reca
title: Add a cited-answer seam on top of cross-store recall returning one synthesized answer per query
status: ready
priority: p2
area: architecture
summary: Extend the recall fan-out by adding an answer-synthesis seam: take one query, run cross-store recall, ask the model to compose one short cited answer with structured citation markers tied back to typed RecallHits, and expose it through one daemon route + one KotaClient namespace + one kota answer CLI subcommand. Surface fan-out (Telegram, web, macOS, mobile) lands as honest follow-ups, not as parallel chains seeded all at once.
created_at: 2026-04-27T10:33:59.991Z
updated_at: 2026-04-27T10:33:59.991Z
---

## Problem

The cross-store recall seam (`src/modules/recall/`, commit `09d60ce3`)
now returns one ranked, source-tagged list of `RecallHit`s across
knowledge, memory, history, and repo tasks, and it is reachable from
Telegram (`6510f998`), the daemon HTTP route (`POST /api/recall`), the
web client (`9a96682a`), the macOS menu bar (`559d9eed` + `b7ea172b`),
the mobile client (`eca5b01a`), and the `kota recall` CLI subcommand
that shipped with the seam. Recall fan-out is therefore complete: every
operator surface can ask one question and get one ranked list of
sources back.

What is still missing is the next personal-assistant capability: an
*answer*. Today the operator must read three to ten ranked hits and
mentally synthesize the answer themselves. A "second brain" is not a
search engine — the natural next step is to feed the top recall hits
into the model and return one short composed answer with citations
back to the underlying typed hits, so the operator gets the resolved
question first and the source list second.

There is no shared synthesis primitive today. Adding one ad-hoc on top
of `RecallProvider` would mean every consumer (CLI, channels, clients)
re-implements its own prompt, citation rendering, and response shape,
which is exactly the churn the recall seam was built to avoid. The
right move is one typed seam: query in, one cited answer out, with
citation markers anchored to the same `RecallHit` discriminated union
the recall seam already exposes.

## Desired Outcome

- A single typed `AnswerProvider` (or equivalent) primitive lives in
  one owning module and takes a natural-language query plus optional
  filters (max hits, score floor, source filter) and returns one
  synthesized answer with structured citations.
- The seam delegates retrieval to `RecallProvider.recall(query)`. It
  does not ship a second retrieval path, a second normalization rule,
  or a second contributor registry. New stores join through the
  existing `RecallContributor` protocol, not through this module.
- The synthesizer asks the model for one short answer (target a few
  sentences, hard cap so the response stays on the operator's screen)
  with inline citation markers in a fixed shape (e.g.
  `[knowledge:abc123]`, `[memory:def456]`, `[history:42]`,
  `[task:task-add-recall]`). The marker shape is typed, not
  prose-pattern-matched: the seam parses the model output into a
  typed `AnswerCitation[]` keyed back to the original `RecallHit`s,
  and the response shape is a discriminated `{ ok: true; answer:
  string; citations: AnswerCitation[]; hits: RecallHit[] } | { ok:
  false; reason: "no_hits" | "semantic_unavailable" | "synthesis_failed" }`.
- Citations resolve back to the typed hit in `hits` by id; an unknown
  citation marker in the model output is dropped (or the synthesis is
  retried once) rather than silently kept as a broken pointer. No
  hallucinated sources reach the operator.
- The seam exposes one daemon route (`POST /api/answer` and its
  daemon-control twin), one `KotaClient.answer` namespace, and one
  `kota answer <query>` CLI subcommand rendered through
  `src/modules/rendering`. Other surfaces (Telegram, macOS, mobile,
  web) intentionally land later as their own follow-ups so this task
  ships the *seam*, not a five-surface fan-out chain.
- Behavior degrades cleanly: `recall` returning zero hits surfaces as
  `{ ok: false, reason: "no_hits" }`; an `ok: false,
  reason: "semantic_unavailable"` from `recall` surfaces verbatim; a
  synthesis-side failure (model unreachable, malformed citations after
  retry) surfaces as `{ ok: false, reason: "synthesis_failed" }`. The
  `--json` path keeps the structured envelope.

## Constraints

- One mechanism. The synthesizer is a thin layer over the existing
  recall seam; it does not register a parallel "answer" provider
  registry, a parallel embedding cache, or a parallel CLI rendering
  helper.
- Module-first. The owning module lives under `src/modules/answer/`
  (or equivalent). It declares `recall`, `model-clients`, and
  `rendering` as runtime dependencies and stays under the repo's
  300-line file-size guideline per file.
- Strict typed protocols. `AnswerCitation` is keyed by `{ source,
  id }` — not a free string — so the response is always
  reconstructable against the typed `hits` list. The response is a
  discriminated union; no nullable fields, no optional answer that
  admits `{ ok: true, answer: undefined }`.
- The model prompt is internal and small. Keep it co-located with the
  seam; do not expose a "prompt template" knob to consumers in this
  task. Future tuning lands as a focused follow-up.
- One model call per `answer(query)` by default. The seam may retry
  *once* on malformed-citation output, but it must not silently fan
  out to multiple calls per query.
- Cost signals do not flow back to autonomy agents. The model client
  the seam uses is the project's normal model-client provider; no
  cost dashboard, no per-query budget enforcement is added here. (See
  the project's standing rule against cost bias in autonomy.)
- No legacy or compatibility shim. The `answer` namespace launches as
  the only synthesis path; the existing `recall` namespace stays
  exactly as-is and continues to be the right primitive for "give me
  the source list".
- One daemon HTTP route, one KotaClient namespace, one CLI subcommand
  in this task. Channel and client fan-out is explicitly out of scope
  here; do not pre-emptively seed Telegram / macOS / mobile / web
  follow-ups in the same run.

## Done When

- A new module (e.g. `src/modules/answer/`) owns the `AnswerProvider`
  primitive, the synthesis prompt, the citation parser, and the
  discriminated response shape. The module declares `recall`,
  `model-clients`, and `rendering` as runtime dependencies through
  `KotaModule.dependencies`.
- `AnswerProvider.answer(query, filters?)` returns a typed answer
  envelope on a representative fixture, with a stable answer shape
  for the same query against the same store contents.
- Citation parsing rejects unknown markers and retries the synthesis
  once before returning `{ ok: false, reason: "synthesis_failed" }`.
- Daemon exposes `POST /api/answer` (and its `POST /answer`
  daemon-control twin) backed by the seam, and
  `KotaClient.answer.answer(query, filters?)` reaches it from both
  daemon-up and daemon-down code paths via the existing `localClient`
  / daemon-link composer.
- `kota answer <query>` CLI subcommand exists in the owning module's
  `cli.ts` and renders the answer through `src/modules/rendering`,
  showing the synthesized prose followed by a typed citation list
  (source badge + id + score + title/preview). `--json` keeps the
  structured envelope.
- Tests cover: (a) unit behavior of the synthesis + citation parse
  step against a synthetic fixture, including the malformed-citation
  retry, (b) the three `ok: false` reasons (no_hits,
  semantic_unavailable propagated from recall, synthesis_failed),
  (c) HTTP route round-trip with discriminated response, (d) CLI
  rendered output and `--json` parity.
- The owning module's `AGENTS.md` describes the seam at the
  conventions level — what the primitive does, the typed citation
  contract, the degradation rules — without enumerating per-store
  wire details.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-27T10-32-08-331Z-explorer-eitskz/` after the
mobile `RecallScreen` (commit `eca5b01a`) closed the cross-store recall
fan-out across Telegram, daemon HTTP, web, macOS DaemonClient, macOS
RecallView, and mobile. The dominant recent autonomy cycle has been
"give every operator surface one ranked list across the second brain"
(52 surface tasks since the seam work began). The next product
capability — "give me the answer, not just the source list" — does
not yet exist in any module. The owner-direction signal pointing this
way is the recall seam's own `Initiative`: "personal-assistant
retrieval ... without making the operator pre-decide which store the
answer lives in." A ranked list is the source pile; an answer is the
resolved question.

## Initiative

Personal-assistant answering: KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain, not just a ranked list of sources. This task lands the seam;
surface adoption (Telegram, macOS, mobile, web) lands later as honest
single-task follow-ups, not as parallel five-surface fan-out chains
seeded all at once.

## Acceptance Evidence

- Diff covering the new owning module, the typed `AnswerProvider`
  primitive, the synthesis prompt and citation parser, the daemon
  HTTP route, the `KotaClient.answer` namespace, and the `kota
  answer` CLI subcommand.
- Unit tests for the synthesis + citation parse step against a
  synthetic fixture, including the malformed-citation retry path
  and the three `ok: false` reasons.
- HTTP-level tests proving daemon-up and daemon-down parity for the
  `answer` namespace.
- A captured CLI transcript under the run directory showing
  `kota answer <query>` returning a synthesized answer with at least
  two citations across two source arms (rendered output + `--json`
  payload), with source-keyed citations resolvable against the typed
  `hits` list in the same response.
- Module's `AGENTS.md` documenting the typed citation contract and
  the degradation rules.
