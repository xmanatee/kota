---
id: task-add-web-retractpanel-consuming-the-cross-store-ret
title: Add web RetractPanel consuming the cross-store retract seam
status: ready
priority: p2
area: modules
summary: Add a sidebar RetractPanel to the web client that consumes POST /api/retract through DaemonControlClient.retract.retract({ target, ... }), exhaustively rendering the discriminated RetractResult — removed, no_contributors, not_found, contributor_failed — and offering a typed target picker that maps one-to-one to RetractTarget with the per-arm identifier control (memory id / knowledge slug / task id / inbox path). Second-surface follow-up of the cross-store retract seam after Telegram /retract-<store>; macOS and mobile adoption land later as separate tasks.
created_at: 2026-04-28T11:31:56.733Z
updated_at: 2026-04-28T11:31:56.733Z
---

## Problem

The cross-store retract seam landed at commit `546cacab` with a
`RetractProvider` primitive, the typed `RetractContributor` registry
binding the memory / knowledge / tasks / inbox removers, the
`POST /retract` daemon-control route plus its user-facing `POST /api/retract`
twin (both share `createRetractRouteHandler` so the wire shape cannot
drift), the `KotaClient.retract` namespace, the `kota retract` CLI
subcommand, and an agent-callable `retract` tool with `dangerous`
risk. The first single honest surface follow-up — Telegram
`/retract-<store>` commands — landed at commit `9ba14254`, giving
phone-resident operators the symmetric correction-side entry the
capture, recall, and answer chat surfaces had already built.

The web dashboard already exposes the read-side trio (`RecallPanel`,
`AnswerPanel`, `AnswerHistoryPanel`) plus the write-side `CapturePanel`
(commit `d9d34b89`). It has no parallel correction-side panel. From the
dashboard an operator can file a note and read back what we know about
X, but cannot remove a single mistaken record without dropping into the
CLI, switching to Telegram, or hand-editing the per-store file. That
is the exact asymmetry the retract seam was designed to remove on the
agent and CLI surfaces, and the dashboard is the next surface in the
established adoption order after Telegram.

The seam is precise on purpose: every contributor consumes its own
typed identifier (memory `id`, knowledge `slug`, task `id`, inbox
`path`), and the seam never falls back to a different target on
`not_found`. There is no auto-classifier, no ambiguous arm — the
operator (or agent) always names the store. The panel must reflect
that contract literally rather than inventing a free-text classifier
or a dropdown that hides the per-arm identifier shape.

## Desired Outcome

`clients/web/src/components/sidebar/RetractPanel.tsx` renders a
target-first form powered by
`DaemonControlClient.retract.retract(request)`:

- A target picker offers exactly the registered `RetractTarget`
  options (`memory` / `knowledge` / `tasks` / `inbox`) ordered by
  `RETRACT_TARGET_ORDER`. There is no `auto` option; the panel does
  not invent a classifier the seam does not expose.
- The identifier control is typed against the chosen target's arm of
  `RetractRequest` — a labeled input for `id` (memory, tasks), `slug`
  (knowledge), or `path` (inbox). The control narrows on the picker
  value through an exhaustive switch over `RetractTarget` with no
  `default` branch; switching the target resets the identifier so a
  knowledge `slug` cannot be submitted as a memory `id`.
- Empty/whitespace identifiers do not fire a request. The submit
  button is disabled until both target and identifier are set.
- The discriminated `RetractResult` renders exhaustively, mirroring how
  `CapturePanel` already renders `CaptureResult`:
  - `ok: true` shows a success row with the removed record's `target`
    badge, the typed identifier, any path metadata the contributor
    returned, and (for `tasks`) the resulting state badge `"dropped"`
    so the surface reads "moved to dropped", not "deleted".
  - `ok: false; reason: "no_contributors"` shows a fixed message
    ("Retract unavailable — no contributors registered for <target>.").
  - `ok: false; reason: "not_found"` shows the named `target` plus the
    submitted `identifier` verbatim and a fixed "no record found"
    message — no auto-retry into a different store.
  - `ok: false; reason: "contributor_failed"` shows the offending
    `target` plus the contributor's `message` verbatim.
- The submit interaction surfaces a confirmation step before firing
  the mutation, since the seam's dangerous risk classification is
  load-bearing on the agent surface and the dashboard surface should
  not be quieter about it. A second click on the same draft executes
  the request.
- The panel mounts in `Sidebar.tsx` next to the existing
  `CapturePanel` so the symmetric write/correction pair sits side by
  side. Existing panels stay unchanged.
- The web client's `api/types.ts` and `api/client.ts` gain the typed
  `RetractResult` / `RetractRequest` / `RetractTarget` re-exports plus
  `api.retract(request)`, mirroring how `api.capture`, `api.recall`,
  and `api.answer` are already exposed.

## Constraints

- One mechanism. The panel consumes the existing
  `DaemonControlClient.retract.retract` namespace exactly the way
  `CapturePanel` consumes its seam; it does not introduce a second
  removal path, a second per-target dispatcher, or a second renderer
  for `RetractResult`. The agent-callable `retract` tool's risk
  classification is a module-internal detail — the panel never
  inspects or surfaces it.
- Use `@tanstack/react-query` and the existing `DaemonControlClient`
  wrapper exactly like the other sidebar panels — no new HTTP layer.
  Use the on-submit mutation pattern; do not auto-fire on every
  keystroke.
- The target picker and identifier-control mapping are exhaustive
  against `RetractTarget` at compile time. Adding a fifth contributor
  must surface as a `RetractTarget` extension that fails the switch
  exhaustiveness check, not as a runtime branch the panel silently
  drops.
- The discriminated `RetractResult` union is the single source of
  truth for state. Render it through an exhaustive switch with no
  `default` branch — the same shape `CapturePanel` uses for
  `CaptureResult`. No nullable success fields, no silent fallbacks,
  no legacy `null` aliasing for the unavailable branches.
- Reuse the existing UI primitives (`Input`, `Select`, `Button`,
  `Badge`). Extend the existing `SOURCE_BADGE_VARIANT` shape to
  `RetractTarget` rather than inventing a new badge palette.
- The confirmation step is a panel-local UI concern; do not add a
  second approval surface on top of the daemon's existing approval
  queue. The seam's `dangerous` risk classification governs the agent
  path, not the operator-driven dashboard path.
- No fan-out from this task. macOS `DaemonClient.retract` +
  `RetractView` and mobile `RetractScreen` adoption land as their own
  honest single-task follow-ups.
- No cost surfacing into autonomy-facing context. The retract path is
  not LLM-priced today, but the panel must not log or stream
  per-call cost into anything an autonomous workflow could read.

## Done When

- A new `RetractPanel.tsx` component exists, is mounted in
  `Sidebar.tsx`, and consumes `DaemonControlClient.retract.retract`.
- The four discriminated branches (`ok: true`, `no_contributors`,
  `not_found`, `contributor_failed`) each render their distinct
  fixed view, with the `ok: true` branch surfacing the typed
  identifier and the `tasks` arm explicitly rendering the `"dropped"`
  state badge.
- The target picker offers every registered `RetractTarget` and the
  identifier-control mapping is exhaustive at compile time against
  the literal union — switching the target resets the identifier
  draft.
- A confirmation step gates the actual mutation; submitting an
  unconfirmed draft shows the confirmation prompt rather than firing
  the request.
- A focused component test (`RetractPanel.test.tsx`) covers all four
  branches, the per-target identifier-control narrowing, and the
  confirmation gate against a stubbed `DaemonControlClient`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client.

## Source / Intent

Follow-on to commit `9ba14254` ("Land Telegram /retract-<store>
commands consuming the cross-store retract seam"), which finished the
first single honest surface for the retract seam and explicitly leaves
web, macOS, and mobile adoption as their own single-task follow-ups
(see the "No fan-out from this module" boundary in
`src/modules/retract/AGENTS.md` and the matching constraint in
`task-add-a-unified-cross-store-retract-seam-mirroring-c.md`). The
web dashboard already exposes the read-side trio plus `CapturePanel`;
the missing correction-side panel is the next surface in the
established adoption order, and it closes the visible asymmetry on
the dashboard surface without forcing the operator to drop into the
CLI to remove a single mistaken record.

## Initiative

Cross-store retract fan-out: deliver the unified retract seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single typed correction entry is reachable wherever the operator
is watching, mirroring the capture, recall, and answer chains already
fanned out across the same surfaces.

## Acceptance Evidence

- Diff for the new `RetractPanel.tsx`, its `Sidebar.tsx` mount, the
  `api/client.ts` + `api/types.ts` additions, and the branch-coverage
  test file.
- Test output showing all four discriminated branches plus the
  per-target identifier-control narrowing and the confirmation gate
  render the expected views against a stubbed `DaemonControlClient`.
- Optional screenshot capture under the run directory of the panel
  rendering against a live daemon — at minimum one `ok: true`
  per-target retract and one `not_found` arm.
