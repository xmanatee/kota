---
id: task-web-ui-responsive-layout
title: Make the web UI dashboard responsive for small screens and mobile
status: backlog
priority: p3
area: operator-ux
summary: The web UI uses a fixed three-column layout with no media queries. On a tablet or mobile device the panels overflow and overlap, making the dashboard unusable for quick status checks away from a desktop.
created_at: 2026-03-31T16:34:49Z
updated_at: 2026-03-31T16:34:49Z
---

## Problem

`styles-layout.ts` defines a CSS grid with fixed column widths and no `@media` breakpoints. At
viewport widths below ~900px the sidebar, main panel, and detail panel overlap or clip. The
dashboard is the operator's primary monitoring surface; it should be usable on a tablet or phone
for read-only inspection of run status and approvals even if full chat interaction is not practical
on small screens.

## Desired Outcome

The web UI adapts gracefully at two breakpoints:

- **Tablet (~768px)**: sidebar collapses to a narrow icon rail or a hamburger toggle; the main
  panel uses the full remaining width.
- **Mobile (~480px)**: single-column layout; navigation is a bottom tab bar or a full-screen
  menu; panels stack vertically.

The existing functionality (run history, approvals, sessions, tasks) remains fully accessible on
small screens.

## Constraints

- Use CSS media queries only; no new JavaScript dependencies or layout libraries.
- Keep all changes inside `src/web-ui/styles-*.ts` and `web-ui.ts`; do not introduce a separate
  build pipeline.
- The desktop (≥ 900px) layout must be identical to the current layout after the change.
- Focus on the dashboard shell and navigation; individual panel content can overflow with a
  scrollbar rather than requiring per-panel responsive redesign.

## Done When

- The web UI renders a single-column layout at 480px viewport width without horizontal overflow.
- At 768px the sidebar collapses to allow the main panel to use most of the viewport.
- Desktop layout (≥ 900px) is unchanged.
- Existing web UI tests pass.
