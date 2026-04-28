---
id: task-add-web-capturepanel-consuming-the-cross-store-cap
title: Add web CapturePanel consuming the cross-store capture seam
status: ready
priority: p2
area: modules
summary: Add a sidebar CapturePanel to the web client that consumes POST /api/capture through DaemonControlClient.capture.capture(text, filter?), exhaustively rendering the discriminated CaptureResult — minted record, ambiguous suggestions, no_contributors, and contributor_failed — and offering a typed target override that maps one-to-one to the seam's CaptureTarget union. Second-surface follow-up of the cross-store capture seam after Telegram /capture; macOS and mobile adoption land later as separate tasks.
created_at: 2026-04-28T04:18:39.808Z
updated_at: 2026-04-28T04:18:39.808Z
---

## Problem

The cross-store capture seam landed at commit `805a6edf` with a
`CaptureProvider` primitive, the typed `CaptureContributor` registry
binding the memory / knowledge / tasks / inbox writers, the
`POST /capture` daemon-control route plus its user-facing `POST /api/capture`
twin, the `KotaClient.capture` namespace, and a `kota capture <text>`
CLI subcommand with `--target` / `--hint` / `--json`. The first single
honest surface follow-up — Telegram `/capture <text>` plus four
`/capture-to-<store>` overrides — landed at commit `d4c35d1e`, giving
phone-resident operators the one symmetric write-side entry the recall
and answer chat surfaces had already built.

The web dashboard already exposes `RecallPanel` (commit `1d3dcefb`),
`AnswerPanel` (commit `1d3dcefb`), and `AnswerHistoryPanel` (commit
`8e263891`) — the unified read-side trio. It has no parallel write-side
panel. From the dashboard an operator can ask "show me everything we
know about X" and "synthesize a cited answer about X", but cannot file
a single natural-language note and let the seam route it. They have to
drop into the CLI, switch to Telegram, or open one of the per-store
write surfaces and pre-decide which store the note belongs in — the
exact taxonomy-decision asymmetry the capture seam was designed to
remove.

The dashboard is a low-friction "type into the open browser" surface.
It is the right place for the read-side trio's symmetric write entry,
and it is the next surface in the established adoption pattern after
Telegram.

## Desired Outcome

`clients/web/src/components/sidebar/CapturePanel.tsx` renders a
text-area plus a target-override control powered by
`DaemonControlClient.capture.capture(text, filter?)`:

- A multi-line input collects the note. Empty/whitespace submissions
  do not fire a request.
- A target-override control offers `auto` plus one option per
  registered `CaptureTarget` (`memory` / `knowledge` / `tasks` /
  `inbox`). `auto` calls `capture.capture(text)` so the seam classifier
  picks; an explicit pick calls `capture.capture(text, { target })`.
  The control is exhaustive against `CaptureTarget` at compile time —
  no `default` branch, no string-keyed map.
- The discriminated `CaptureResult` renders exhaustively, mirroring how
  `AnswerPanel` already renders the discriminated `AnswerResult`:
  - `ok: true` shows a success row with the minted record's `target`
    badge, the typed identifier (memory id, knowledge slug, task id,
    inbox slug), and any path metadata the contributor returned.
  - `ok: false; reason: "ambiguous"` shows a fixed message plus the
    `suggestions` list rendered as one button per suggestion that
    re-issues `capture.capture(text, { target: suggestion })`.
  - `ok: false; reason: "no_contributors"` shows a single fixed
    message ("Capture unavailable — no contributors registered.").
  - `ok: false; reason: "contributor_failed"` shows the offending
    `target` plus the `message` verbatim.
- Source ordering for the suggestions list reuses the seam's
  `CAPTURE_TARGET_ORDER`; the panel does not re-sort.
- The panel mounts in `Sidebar.tsx` next to the existing read-side
  trio so the live-compose / history-readback / capture views sit side
  by side. The existing panels stay unchanged.
- The web client's `api/types.ts` and `api/client.ts` gain the typed
  `CaptureResult` / `CaptureTarget` / `CaptureFilter` re-exports plus
  `api.capture(text, filter?)`, mirroring how `api.recall` and
  `api.answer` are already exposed.

## Constraints

- One mechanism. The panel consumes the existing
  `DaemonControlClient.capture.capture` namespace exactly the way
  `RecallPanel` and `AnswerPanel` consume their seams; it does not
  introduce a second write path, a second per-target dispatcher, or a
  second renderer for `CaptureResult`. The classifier prompt is a
  module-internal detail — the panel never inspects or surfaces it.
- Use `@tanstack/react-query` and the existing `DaemonControlClient`
  wrapper exactly like the other sidebar panels — no new HTTP layer.
  Use the on-submit mutation pattern (`useMutation` or `useQuery` with
  an `enabled` guard against an empty draft); do not auto-fire on
  every keystroke.
- The discriminated `CaptureResult` union is the single source of
  truth for state. Render it through an exhaustive switch with no
  `default` branch — the same shape `AnswerPanel` uses for
  `AnswerResult`. No nullable success fields, no silent fallbacks, no
  legacy `null` aliasing for the unavailable branches.
- Reuse the existing UI primitives (`Input`, `Textarea`, `Button`,
  `Badge`, `Select`). Do not invent new sidebar layout components or a
  new badge palette — extend the existing `SOURCE_BADGE_VARIANT` shape
  to `CaptureTarget` if a per-target badge is rendered.
- No fan-out from this task. macOS `DaemonClient.capture` + `CaptureView`
  and mobile `CaptureScreen` adoption land as their own honest
  single-task follow-ups.
- No cost surfacing into autonomy-facing context. The classifier's
  per-call cost is the seam's responsibility and stays inside the
  cost tracker the recall and answer seams already share. The panel
  must not display, log, or otherwise leak per-call cost.

## Done When

- A new `CapturePanel.tsx` component exists, is mounted in
  `Sidebar.tsx`, and consumes `DaemonControlClient.capture.capture`.
- The four discriminated branches (`ok: true`, `ambiguous`,
  `no_contributors`, `contributor_failed`) each render their distinct
  fixed view, and the ambiguous-branch suggestion buttons re-issue
  `capture.capture` with the chosen `target`.
- The target-override control offers `auto` plus every registered
  `CaptureTarget` and the auto-vs-explicit-target dispatch is
  exhaustive at compile time against the literal union.
- A focused component test (`CapturePanel.test.tsx`) covers all four
  branches plus the suggestion-button re-issue path against a stubbed
  `DaemonControlClient`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client.

## Source / Intent

Follow-on to commit `d4c35d1e` ("Add Telegram /capture* commands
consuming the cross-store capture seam"), which finished the first
single honest surface for the capture seam and explicitly leaves
macOS, mobile, and web adoption as their own single-task follow-ups
(see the Constraints section of
`task-add-a-unified-cross-store-capture-seam-routing-one.md` and the
"No fan-out from this module" boundary in `src/modules/capture/AGENTS.md`).
The web dashboard already exposes the symmetric read-side trio
(`RecallPanel`, `AnswerPanel`, `AnswerHistoryPanel`); the missing
write-side panel is the next surface in the established adoption
order, and it closes the visible asymmetry on the dashboard surface
without forcing the operator to pre-decide between memory / knowledge /
tasks / inbox before typing the note.

## Initiative

Cross-store capture fan-out: deliver the unified capture seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single natural-language "save this for me" entry is reachable
wherever the operator is watching, mirroring the recall and answer
chains already fanned out across the same surfaces.

## Acceptance Evidence

- Diff for the new `CapturePanel.tsx`, its `Sidebar.tsx` mount, the
  `api/client.ts` + `api/types.ts` additions, and the branch-coverage
  test file.
- Test output showing all four discriminated branches plus the
  suggestion-button re-issue path render the expected views against a
  stubbed `DaemonControlClient`.
- Optional screenshot capture under the run directory of the panel
  rendering against a live daemon — at minimum one `ok: true`
  per-target capture and one `ambiguous` suggestion-button re-issue.
