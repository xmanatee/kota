---
id: task-add-macos-menu-bar-knowledgeview-consuming-apiknow
title: Add macOS menu bar KnowledgeView consuming /api/knowledge/search
status: dropped
priority: p2
area: client
summary: Add a Knowledge view in the macOS menu bar client that calls GET /api/knowledge/search (semantic + limit), renders the same top-N entry shape the Telegram /knowledge command and shared knowledge render helper already emit, and surfaces the semantic-unavailable branch one-to-one — extending the knowledge surface fan-out from Telegram to the always-visible native operator surface.
created_at: 2026-04-26T12:16:20.605Z
updated_at: 2026-04-26T12:53:53.603Z
---

## Problem

The `knowledge` module's operator-pull surface is now exposed on four
clients:

- `kota knowledge {list, search, show, ...}` CLI
  (`src/modules/knowledge/cli.ts`).
- Daemon HTTP `GET /api/knowledge` and `GET /api/knowledge/search`
  (`src/modules/knowledge/routes.ts`); the search route returns
  `{ ok: true, entries: KnowledgeEntry[] } | { ok: false, reason:
  "semantic_unavailable" }` so callers do not silently degrade to keyword
  search behind the operator's back.
- Embedded web `KnowledgePanel`
  (`clients/web/src/components/sidebar/KnowledgePanel.tsx`).
- Telegram `/knowledge <query>` command
  (`src/modules/telegram/status-poll.ts:105-136`,
  `src/modules/telegram/AGENTS.md`), rendered via the shared
  `renderKnowledgeSearchPlain` helper in `src/modules/knowledge/render.ts`.

The macOS menu bar — the always-visible operator surface that already
hosts the `DigestView` and `AttentionView` from the prior fan-outs — has
no Knowledge surface. `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`
exposes typed methods for `/status`, `/approvals`, `/owner-questions`,
`/tasks`, `/sessions`, `/api/digest`, `/api/attention`, voice, and chat,
but has no `searchKnowledge()`; `MenuBarView.swift` has no Knowledge
section. Operators supervising KOTA from the menu bar today must context-
switch to a terminal, browser, or Telegram chat to query the project
knowledge store, even though the daemon is already serving the search
body.

## Desired Outcome

The macOS menu bar gains a Knowledge surface — a `KnowledgeView` rendered
from `MenuBarView.swift` (collapsible section consistent with the Digest
and Attention sections) — that lets the operator type a query, calls
`GET /api/knowledge/search?q=<query>&semantic=true&limit=10` through the
existing `DaemonClient`, decodes the typed `{ ok, entries | reason }`
response, and renders the top entries one line each: id, type, status,
and title (the same line shape `renderKnowledgeSearchPlain` and the CLI
`buildKnowledgeSearchLines` already emit). The semantic-unavailable
branch surfaces explicitly to the operator with a one-line explanation,
not a silent degrade. Empty / whitespace-only queries surface an inline
usage hint and skip the request. Empty result sets surface a fixed
"No matching knowledge entries." body so the operator can distinguish
"nothing matched" from "command failed". The view uses the existing
`DaemonClient` / `AppState` model that every other section uses; it does
not introduce a parallel data layer or duplicate the rendering logic
that already lives in the `knowledge` module.

## Constraints

- Reuse the existing `DaemonClient` (`clients/macos/Sources/KotaMenuBar/
  DaemonClient.swift`) and `AppState` patterns (`AppState.swift`). Add a
  typed `searchKnowledge(query:limit:)` method and the corresponding
  `Models.swift` types (`KnowledgeEntry`, `KnowledgeSearchResponse` with
  the `ok: true | false` discriminated shape), not an ad-hoc
  `URLSession` call inside the view.
- Mirror the route response shape exactly: `{ ok: true, entries:
  KnowledgeEntry[] }` on success and `{ ok: false, reason:
  "semantic_unavailable" }` when no embedding-backed knowledge provider
  is configured. Decode via `JSONDecoder` against typed Swift structs.
  Do not invent a parallel response type that drifts from the daemon's
  contract.
- Render each entry using the same line shape the shared knowledge
  render helper emits — id, type, status, and title. Do not re-implement
  Markdown styling, do not strip fields, and do not invent a new line
  format that diverges from Telegram / CLI / web.
- Empty / whitespace-only query: do not call the route. Show a usage
  hint inline ("Type a query to search knowledge."). Empty result set
  with a non-empty query: render the fixed "No matching knowledge
  entries." body. `ok: false`: render a one-line explanation that
  semantic search requires an embedding-backed knowledge provider; do
  not retry the request without semantic.
- Auth model matches the rest of `/api/*`: requests carry the bearer
  token from `daemon-control.json` via the existing `DaemonConnection`.
  No per-route bypass.
- The on-demand pull invariants stay intact: the macOS client must not
  emit a workflow event, must not advance any cadence file, and the
  rendered body must not flow into any agent prompt path. The macOS
  client never reads `.kota/` files directly except through the existing
  `daemon-control.json` discovery path (`clients/macos/AGENTS.md`), and
  that boundary is preserved.
- One mechanism. A single `KnowledgeView` consumed by `MenuBarView.swift`,
  not two duplicated render paths. The query input, debounce / submit
  behaviour, results list, and error states all live in `KnowledgeView.swift`
  alongside the same patterns `DigestView.swift` and `AttentionView.swift`
  use; do not introduce a separate sheet or window for the search.
- No backwards-compatibility shim for older daemon builds that lack
  `/api/knowledge/search`. If the route 404s, surface the daemon's typed
  error one-to-one the way approvals/owner-questions/digest views
  already surface their daemon failure modes.
- If the `DaemonClient` hits an HTTP error, the view shows the same
  offline/error state pattern other views use; it must not preserve a
  stale knowledge result across an offline transition
  (`clients/macos/AGENTS.md`).
- The view never reads the file-backed `KnowledgeStore` directly. All
  data flows through the daemon HTTP route. Do not import a knowledge
  parser or storage helper into the macOS client.

## Done When

- A `KnowledgeView.swift` lives under `clients/macos/Sources/KotaMenuBar/`
  and is wired into `MenuBarView.swift` so operators can search the
  knowledge store without leaving the menu bar.
- `DaemonClient.swift` has a typed `searchKnowledge(query:limit:)`
  method returning the discriminated `KnowledgeSearchResponse`, and
  `Models.swift` declares the `KnowledgeEntry` Swift mirror plus the
  response wrapper.
- `AppState.swift` exposes the search state (current query, current
  result, in-flight, last error) with the same observable pattern other
  sections use; the view renders the rendered line shape, the empty-
  result body, the empty-query usage hint, and the semantic-unavailable
  explanation.
- Tests under `clients/macos/Tests/KotaMenuBarTests/` exercise
  `DaemonClient.searchKnowledge()` for: a successful entries payload, an
  empty entries payload, the `ok: false` semantic-unavailable payload,
  and the typed error path when the route fails. Pair these alongside
  the existing `DaemonClientTests.swift` patterns.
- `swift build` and `swift test` are green for the macOS client.
- Documentation aligned: `src/modules/knowledge/AGENTS.md` names the
  macOS menu bar as a consumer of the knowledge surface (one-line
  update, not a duplicated catalog). `clients/macos/AGENTS.md` does not
  need to enumerate the new view — the generic "all state comes from
  the daemon API through the daemon client wrapper" guidance already
  covers it.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the Telegram
`/knowledge` command landing (commit `f2d1a248` and the seeding commit
`53883ef2` that explicitly opened the knowledge surface fan-out at the
Telegram surface). Both the daily-digest and attention-digest fan-outs
established the same Telegram → CLI → daemon HTTP → web → macOS →
mobile cadence, with macOS following web. Knowledge already has the
CLI, daemon HTTP route, web `KnowledgePanel`, and Telegram surface in
place; macOS and mobile remain. macOS is the always-visible daily-
supervision surface and is the natural next consumer of the shared
search body. Without this task, the daemon endpoint ships and Telegram
exposes it, but the menu-bar operator still has to context-switch to a
terminal, browser, or chat to search the knowledge store.

## Initiative

Operator-pull parity for the knowledge surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares one
search seam through `GET /api/knowledge/search`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication.

## Acceptance Evidence

- Diff covering the new `KnowledgeView.swift`, the typed
  `searchKnowledge(query:limit:)` on `DaemonClient`, the `KnowledgeEntry`
  + `KnowledgeSearchResponse` mirrors in `Models.swift`, the `AppState`
  observables, the wiring into `MenuBarView.swift`, and the
  `DaemonClientTests.swift` cases.
- Screenshot under `.kota/runs/<run-id>/` of the menu bar rendering: a
  successful search with entries, the empty-result body, the empty-query
  usage hint, and the semantic-unavailable explanation. Pair the
  successful case alongside the corresponding `kota knowledge search`
  text and Telegram `/knowledge` reply for the same query and same
  project state to demonstrate body parity across surfaces.
- Test output showing the new `DaemonClientTests` cases passing.

## Decomposed

Builder timed out (~17 min, streamed-API idle timeout) in
`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp/` while still in the
contract-design phase. The original task bundles the daemon contract
layer, the SwiftUI view layer, AppState observables, MenuBarView
integration, four-branch operator screenshots, and a docs update — too
much for one builder run. Split into:

- `task-add-macos-daemonclientsearchknowledge-with-discrim` — typed
  Swift mirrors (`KnowledgeEntry`, discriminated `KnowledgeSearchResponse`),
  `DaemonClient.searchKnowledge(query:limit:)`, and the four
  `DaemonClientTests` cases (success entries, empty entries, ok:false
  semantic-unavailable, typed HTTP error). Independently shippable;
  no UI surface yet.
- `task-add-macos-menu-bar-knowledgeview-consuming-daemonc` — depends
  on the contract layer above. Adds `KnowledgeView.swift`, AppState
  observables, MenuBarView wiring, the four-branch operator
  screenshots, and the one-line `src/modules/knowledge/AGENTS.md`
  consumer update.

