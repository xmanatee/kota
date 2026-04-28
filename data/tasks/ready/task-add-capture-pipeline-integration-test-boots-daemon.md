---
id: task-add-capture-pipeline-integration-test-boots-daemon
title: Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure
status: ready
priority: p2
area: architecture
summary: Anchor the just-fanned-out cross-store capture seam with one top-level integration test that boots the daemon over seeded memory/knowledge/tasks/inbox contributors, exercises POST /capture and POST /api/capture through KotaClient.capture for every CaptureRecord arm, the ambiguous-classifier fallback, and a contributor-failed path, and asserts the typed CaptureResult wire shape so subtle drift across the Telegram, web, macOS, mobile, and Slack surfaces cannot land silently.
created_at: 2026-04-28T06:08:53.648Z
updated_at: 2026-04-28T06:08:53.648Z
---

## Problem

The last ~14 commits shipped the cross-store capture seam (`POST /capture`,
`POST /api/capture`, `KotaClient.capture`, `kota capture <text>`) and fanned
it out into Telegram (`/capture` plus the four `/capture-to-{memory,
knowledge,tasks,inbox}` twins), web (`CapturePanel`), macOS
(`DaemonClient.capture`, menu-bar `CaptureView`), mobile (`CaptureScreen`),
and Slack-channel slash commands. Five operator surfaces now consume the
same wire shape: a discriminated `CaptureResult` whose success arm carries a
`CaptureRecord` discriminated by `target ∈ {memory, knowledge, tasks,
inbox}`, plus three failure arms (`ambiguous`, `no_contributors`,
`contributor_failed`).

Coverage today is per-module: `src/modules/capture/routes.test.ts`
exercises the route handler, `src/modules/capture/contributors.test.ts`
covers the contributor adapters, and `src/modules/capture/cli.test.ts`
covers the CLI subcommand. There is no top-level test that boots the daemon,
registers real contributors backed by the same in-process writers each
contributor delegates to (`MemoryProvider.save`, `KnowledgeProvider.create`,
`createNormalizedTask`, an inbox `writeFileSync`), and walks the full
pipeline through HTTP for every `CaptureRecord` arm plus the documented
failure arms.

The recall+answer side of the same fan-out cluster is already anchored by
`src/recall-answer-pipeline.integration.test.ts`. The capture seam is the
remaining hole. A subtle drift in any wire invariant (e.g. the
`CaptureRecord` discriminator stops matching `CaptureTarget`, the seam
silently retries a failed contributor into a different store, the
classifier-unavailable path stops surfacing `ambiguous`, the per-target
identifier shape changes between memory id / knowledge slug / task id /
inbox file slug, the route handler twins drift between `POST /capture` and
`POST /api/capture`) would compile and pass per-module tests yet break
Telegram, web, macOS, mobile, and Slack in lockstep with no signal until
an operator hits it.

## Desired Outcome

One top-level integration test exercises the full capture pipeline through
the daemon HTTP surface against seeded contributors:

- The test boots a daemon (or the same thin in-process equivalent that
  wires the real `createCaptureRouteHandler` the way the recall+answer
  pipeline test wires recall and answer route handlers) into a temporary
  project state root.
- All four contributors are registered against real in-process providers
  (`MemoryProvider`, `KnowledgeProvider`, repo-tasks store, an inbox
  directory) so each `CaptureRecord` arm round-trips through the actual
  writer the contributor delegates to.
- The classifier is replaced with a deterministic in-process stub that
  returns a chosen target for one query and `AMBIGUOUS` for another, so
  the routing-rules truth table is exercised without a real model call.
- For each `CaptureTarget` literal, `POST /capture` with an explicit
  `target` mints a `CaptureRecord` whose discriminator matches the target
  and whose typed identifier (memory id, knowledge slug, task id, inbox
  file slug) is asserted against the freshly-written record on disk.
- One `POST /capture` without `target` plus a confident classifier reply
  routes to the chosen contributor and produces the matching
  `CaptureRecord` arm.
- One `POST /capture` without `target` plus an `AMBIGUOUS` classifier
  reply surfaces `{ ok: false, reason: "ambiguous", suggestions }` with
  the full registered-contributor list.
- One `POST /capture` against a contributor that is configured to throw
  surfaces `{ ok: false, reason: "contributor_failed", target, message }`
  carrying the thrown message verbatim.
- Empty / whitespace-only text surfaces `ambiguous` with the full
  suggestions list and writes nothing to any store.
- One call against the user-facing twin `POST /api/capture` (same shared
  handler) is asserted to return byte-identical JSON to its daemon-control
  counterpart, locking the contract that the two routes cannot drift.

## Constraints

- One mechanism. The test must drive the same route handler / client
  namespace real operator surfaces use; it must not introduce a parallel
  HTTP shim, a second daemon-control protocol, or a "test-only" route or
  flag.
- The seeded providers, the classifier stand-in, and the assertions all
  live in one new file under `src/`, named per the existing naming
  convention (e.g. `capture-pipeline.integration.test.ts`) so
  `src/root-layout.test.ts` accepts it without an allowlist edit.
- The classifier is replaced with a deterministic in-process stub; do not
  call a real model in CI.
- No production code may grow a test-only flag, hook, or override. Reach
  the seam through dependency injection paths that already exist
  (`CaptureProvider.register()`, route handler factories, classifier
  injection point) or through configuration surfaces shipped with the
  module.
- Persisted records are asserted through `KotaClient.capture` and through
  reading back the contributor's existing query path (e.g. the typed
  memory id resolves through `MemoryProvider.get` if available, the
  inbox slug appears as a file under the seeded inbox directory, etc.) —
  not through bespoke filesystem-shape assumptions baked into the test.
- The test runs under `pnpm test` without external network access and
  cleans up its temp project root.

## Done When

- `src/capture-pipeline.integration.test.ts` exists, covers every
  `CaptureRecord` arm plus the four documented failure paths
  (`ambiguous` from classifier, `ambiguous` from empty text,
  `contributor_failed`, twin-route equivalence), and passes under
  `pnpm test`.
- The success path asserts that each `CaptureTarget` literal produces a
  `CaptureRecord` whose discriminator matches the target and whose typed
  identifier resolves to a freshly-written record through the
  contributor's existing read path.
- The classifier-routing path asserts a confident reply dispatches to the
  chosen contributor and an `AMBIGUOUS` reply surfaces the documented
  ambiguous envelope with the registered-contributor suggestion list.
- The contributor-failure path asserts the seam never silently retries
  into a different store and surfaces `contributor_failed` with the
  thrown message verbatim.
- The twin-route path asserts `POST /capture` and `POST /api/capture`
  return byte-identical JSON for the same input, anchoring the shared-
  handler contract.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Deliberately breaking one wire invariant (e.g. dropping the
  classifier-unavailable degradation step, or changing the
  `CaptureRecord` discriminator field name in one client surface) makes
  this test fail.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T06-05-59-251Z-explorer-y8kwfp/` after the recent
capture fan-out cluster (commits `805a6edf` `d4c35d1e` `8ba9d94c`
`85a2bbec` `d9d34b89` `be490c03` `33595c0a` `8c89cc99` `23f9c52e`
`fe68c952` `65aed37e`) ended with five operator surfaces consuming the
same wire shape and no top-level test exercising the pipeline through
the daemon HTTP surface. The recall+answer half of the same cluster is
already anchored by `src/recall-answer-pipeline.integration.test.ts`;
this task closes the matching capture-side gap before any further fan-
out lands on top of the seam.

## Initiative

Module-first, core-shrinking architecture: load-bearing seams that fan
out across operator surfaces are anchored by a single end-to-end
integration test exercising the same route handlers and client
namespaces real surfaces use, so per-module tests plus one cross-module
pipeline test catch protocol drift before it reaches a client.

## Acceptance Evidence

- Diff adding `src/capture-pipeline.integration.test.ts` plus any small
  fixture helpers it needs.
- `pnpm test src/capture-pipeline.integration.test.ts` transcript
  showing every `CaptureRecord` arm and every documented failure path
  passing.
- A short snippet showing a deliberate one-line break in one capture-seam
  invariant (e.g. removing the classifier-unavailable `ambiguous`
  surfacing, or renaming the `CaptureRecord` discriminator in one
  contributor) and the matching red test output, demonstrating the test
  catches drift in the seams it claims to anchor.
