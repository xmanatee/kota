---
id: task-add-web-client-project-selector-and-project-scoped
title: Add web client project selector and project-scoped views
status: done
priority: p2
area: client
summary: Add a project selector and project-scoped routes/SSE subscriptions to the web dashboard so the daemon-backed browser UI renders one project at a time once the daemon hosts multiple project runtimes.
created_at: 2026-05-08T00:00:39.515Z
updated_at: 2026-05-08T04:46:35.200Z
---

## Problem

The web dashboard (`clients/web/`) is single-project today. Routes,
TanStack Query keys, and SSE subscriptions assume one project per
daemon. Once the daemon hosts multiple projects (Variant A), the web
UI has to render one project's runs/queues/owner-questions/approvals at
a time and let the operator switch projects without reloading or
flushing query state.

## Desired Outcome

The web client gains a first-class project-scoped routing layer:

- A persistent selector in the dashboard header lists registered
  projects (from the daemon's typed registry) and marks the active
  project.
- All project-scoped routes render `/<projectId>/...` so query keys,
  navigation, and shareable URLs are unambiguous.
- TanStack Query invalidation and SSE subscriptions are scoped to the
  active `projectId`. Switching projects does not leak rows from the
  previous project into the new view.
- Cross-project views (active runs across all projects) exist only
  where the daemon-foundation task already exposes them. The default
  experience is one project at a time.

## Constraints

- Consume only the daemon control API and SSE event stream. No
  `.kota/` access; no client-side multi-daemon façade.
- Use the daemon's typed registry endpoints from the foundation task —
  do not derive `projectId` heuristically from `projectDir`.
- Keep the selector behavior identical across web, CLI, and (later)
  native clients. Per-platform model variations are not allowed; the
  selector is one daemon contract surface.
- Hide the selector entirely when the daemon hosts exactly one project,
  so KOTA-on-itself experience does not regress.
- `clients/web/AGENTS.md` is updated with the conventions for
  project-scoped routes and query-key composition — at the conventions
  level, not as a route catalog.

## Done When

- The web router exposes project-scoped routes (e.g. `/p/<projectId>/...`)
  for runs, sessions, owner questions, approvals, and the activity
  stream.
- The header carries a typed project selector backed by the registry
  endpoint; switching projects updates the URL, the query cache, and
  the SSE subscription set.
- TanStack Query keys include `projectId` so cross-project leakage is
  impossible by construction.
- A Playwright (or equivalent integration) test boots the daemon with
  two projects, switches between them, and asserts the runs/sessions
  list updates to the selected project's content.
- Visual evidence (screenshot or Playwright trace) shows the selector
  and the per-project view.

## Source / Intent

Decomposition of `task-surface-project-selection-in-operator-clients-for-`
(Variant A, resolved 2026-05-07). The web client is the second operator
surface (after CLI) needed to prove the multi-project supervision model
end to end.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the
same daemon control contract.

## Acceptance Evidence

- A screenshot under `.kota/runs/<run-id>/` showing the selector with
  two projects and a project-scoped runs view, **or** a Playwright
  HTML report committed alongside the integration test.
- The Playwright (or equivalent) integration test exercising a
  selector-driven project switch.

## Unblock Precondition

```
kind: task-done
ref: task-add-daemon-project-registry-and-projectid-attribut
```

Promote this task to `ready/` when the daemon-foundation task lands in
`done/`. The web selector consumes that task's typed registry endpoints.
