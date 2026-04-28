---
id: task-add-a-unified-cross-store-capture-seam-routing-one
title: Add a unified cross-store capture seam routing one natural-language note to the right store
status: ready
priority: p2
area: architecture
summary: Add a CaptureProvider seam that takes one natural-language note (plus an optional explicit target) and routes it through typed CaptureContributors into the existing memory / knowledge / tasks / inbox stores, exposed as one daemon route, one KotaClient.capture namespace, and one kota capture CLI subcommand — the symmetric write-side counterpart to the recall seam.
created_at: 2026-04-28T03:11:17.607Z
updated_at: 2026-04-28T03:11:17.607Z
---

## Problem

The last ~30 commits closed read-side cross-store fan-out: the
`recall` module unified ranked search across knowledge / memory /
history / tasks, the `answer` module layered cited synthesis on top,
the `answer-history` store anchors persisted envelopes, and commit
`cbf7d652` proved the whole pipeline end-to-end. From the operator's
seat, "ask one question across everything" no longer requires
choosing a store first.

The symmetric write-side ask is still fragmented. To save something
KOTA already knows how to store, an operator today has to pick one of
`kota memory remember`, `kota knowledge add`, `kota tasks create`, or
direct `data/inbox/` filesystem editing — and pre-decide which store
the note belongs in before typing the note. Each store has its own
CLI subcommand, its own `KotaClient.<store>` namespace write methods,
its own daemon route, and its own per-surface adoption. There is no
single "save this for me" entrypoint, so every surface (Telegram,
web, macOS, mobile, CLI) either re-implements its own dispatcher or
forces operators to learn the storage taxonomy.

That asymmetry is not just an ergonomic gap; it forces every new
operator surface to either fan out four write commands or pick a
default and silently swallow the others.

## Desired Outcome

A new `src/modules/capture/` module exposes one cross-store capture
seam mirroring the shape of `src/modules/recall/`:

- A `CaptureProvider` primitive whose single method takes
  `{ text: string, target?: CaptureTarget, hint?: string }` and
  returns a discriminated `CaptureResult` envelope. `CaptureTarget`
  is a literal union over the registered contributor sources
  (`"memory" | "knowledge" | "tasks" | "inbox"`).
- A typed `CaptureContributor` protocol every store implements,
  registered through the provider's `register()` API at module
  `onLoad`. Nothing in core hard-codes the contributor set, mirroring
  recall's runtime registration.
- Routing rules:
  - When the caller passes `target`, the seam dispatches verbatim to
    that contributor.
  - When no `target` is given, the seam runs a small classifier
    (configured model client, internal prompt, no public knob) that
    returns one `CaptureTarget` plus a confidence band.
  - If classification is unavailable (no model client) or returns an
    ambiguous result, the seam returns
    `{ ok: false, reason: "ambiguous", suggestions: CaptureTarget[] }`
    so the operator (or an upstream surface) can disambiguate. No
    silent default.
- The seam delegates writes to each store's existing in-process
  writer through the contributor adapter; it never opens a new
  persistence path. Each contributor returns the typed identifier and
  metadata its store already exposes (memory id, knowledge slug,
  task id, inbox file path) so success records resolve back to the
  underlying store the same way recall hits do.
- One daemon-control route `POST /capture` plus its user-facing twin
  `POST /api/capture`, both sharing one `createCaptureRouteHandler`
  so the wire shape cannot drift across surfaces.
- One `KotaClient.capture` namespace exposing the seam through the
  module's `localClient(ctx)` factory.
- One `kota capture <text>` CLI subcommand (with `--target` and
  `--hint` flags) rendered through `src/modules/rendering`.
- Module-internal classifier prompt, contributor adapters, and the
  KotaClient namespace types co-located in this module — no
  per-namespace types added under `src/core/server/`.

## Constraints

- One mechanism. Do not add a second public capture path or a parallel
  registry. The contributor protocol and `register()` API are the
  single way new stores join.
- Strict envelopes. `CaptureResult` is a discriminated union over
  `{ ok: true, target, recordId, store, ... } | { ok: false, reason,
  suggestions? }`. No nullable success fields, no silent fallbacks.
- No fan-out from this module. Telegram, web, macOS, and mobile
  adoption land later as their own honest single-task follow-ups,
  matching the recall+answer pattern. The web client will consume
  `POST /api/capture` later through the same handler.
- No new persistence path. The seam delegates to each store's
  existing writer; it never writes a parallel record on the side and
  never logs a separate envelope. If observability beyond per-store
  records is needed later, it ships as a follow-up store, not as a
  hidden side effect of this seam.
- No public classifier-prompt knob. Tuning the routing prompt lands
  as a focused follow-up, not as a per-call parameter.
- No cost surfacing into autonomy-facing context. The classifier uses
  the project's configured model client; per-call cost stays in the
  cost tracker the recall and answer seams already share.
- The seam must work when no model client is configured: an
  unambiguous explicit `target` always succeeds; an unguided plain-
  text capture without classification surfaces the ambiguous
  envelope rather than throwing or guessing.
- Contributor errors are isolated. A contributor that throws (e.g.
  the inbox writer cannot reach the project root) returns a typed
  contributor-failure arm; the seam does not silently retry into a
  different store.

## Done When

- `src/modules/capture/` exists with `capture-provider.ts`,
  `capture-types.ts`, `contributors.ts`, `routes.ts`, `cli.ts`,
  `render.ts`, `index.ts`, and an `AGENTS.md` describing the
  primitive vocabulary and boundaries at the conventions level.
- The module registers its KotaClient namespace through
  `localClient(ctx)`, contributes `POST /capture` and `POST /api/
  capture` through `KotaModule.controlRoutes`, and registers
  contributors for memory / knowledge / tasks / inbox in `onLoad`.
- `kota capture "remember that I prefer dark themes"` routes to
  memory, `kota capture --target knowledge "typescript discriminated
  unions are exhaustive in switch with no default"` writes a
  knowledge entry, `kota capture --target tasks "review macOS push
  permissions before next release"` creates a task, `kota capture
  "raw thought worth filing"` falls into inbox, and an ambiguous
  unguided text returns the typed `{ ok: false, reason: "ambiguous"
  }` envelope with the contributor list as suggestions. All five
  flows are exercised in tests.
- Co-located tests cover: `capture-provider.test.ts` (routing,
  classification, ambiguous degradation, contributor-throw
  isolation), `contributors.test.ts` (each store contributor's
  success and failure shapes), `routes.test.ts` (HTTP wire shape for
  both routes), and `cli.test.ts` (rendered output for each result
  arm).
- `pnpm typecheck` and `pnpm test` pass; the new module loads
  cleanly under both `kota serve` and one-shot CLI mode; the
  KotaClient namespace selector validates that every declared
  namespace has both a local handler and a daemon handler.
- A short transcript under the run directory shows
  `kota capture` exercising the four success arms and the
  ambiguous arm against a temp project, captured by the builder
  for acceptance evidence.

## Source / Intent

Owner-driven. The recall→answer→answer-history arc (commits
`082c565f` cited-answer seam, `21bdc367` typed answer-history,
`cbf7d652` end-to-end test, plus the per-surface fan-outs in
between) closed read-side cross-store unification. The symmetric
write-side fragmentation now visibly diverges from how operators
interact with KOTA: read = one seam, write = pick one of four
subcommands. The intent is to close that asymmetry with one
foundation seam, then fan it out to Telegram / web / macOS / mobile
as the recall+answer arc was, not to design a five-surface chain
inside this task.

## Initiative

Cross-store capture parity — the symmetric write-side counterpart
to the cross-store recall+answer initiative just closed. This seed
opens a fan-out arc whose follow-ups (Telegram `/capture`, web
`CapturePanel`, macOS `DaemonClient.capture` + `CaptureView`,
mobile `CaptureScreen`, end-to-end integration test) ship as
separate explorer-seeded tasks once this foundation lands.

## Acceptance Evidence

- `pnpm test --filter capture-provider --filter contributors --filter
  capture-routes --filter capture-cli` (or equivalent module-scoped
  invocation) green.
- A run-directory transcript named `capture-cli-evidence.txt`
  showing the five `kota capture` arms (memory, knowledge, tasks,
  inbox, ambiguous) executed against a temp project, with the
  rendered output for each.
- Module `AGENTS.md` documenting the contributor protocol,
  classification rules, and degradation envelopes at the same level
  of detail as `src/modules/recall/AGENTS.md` and
  `src/modules/answer/AGENTS.md`.
