---
id: task-web-ui-dark-mode
title: Add dark mode toggle to the web UI dashboard
status: backlog
priority: p3
area: operator-ux
summary: The web UI dashboard has no dark mode. Operators who run KOTA overnight or in low-light environments have no way to reduce eye strain. A toggle that persists the preference to localStorage would make the dashboard more comfortable for extended use.
created_at: 2026-03-31T06:00:00Z
updated_at: 2026-03-31T06:00:00Z
---

## Problem

The KOTA web UI (`src/web-ui/`) uses a single light color scheme with no dark variant. Operators monitoring autonomous runs at night or in dark environments have no option to reduce screen brightness. The preference should persist across page reloads so operators do not need to re-set it each visit.

## Desired Outcome

A dark/light mode toggle in the web UI header (icon button). Clicking it:
- Adds or removes a `dark` CSS class on `<body>`.
- Saves the preference to `localStorage` (`kota.theme: "dark" | "light"`).
- Restores the preference on page load.

Dark mode colors should cover the main background, sidebar, panels, chat messages, and text. Use CSS custom properties (already used in `styles.ts`) so the dark theme is a single override block rather than scattered overrides.

## Constraints

- Follow the existing module pattern in `src/web-ui/`: add CSS in `styles.ts` (or a new `styles-theme.ts`) and toggle logic in `client-utils.ts` or a dedicated `client-theme.ts`.
- Keep changes self-contained to the web UI layer; do not touch server routes.
- Accessible contrast ratios: text on background must meet WCAG AA (4.5:1 for normal text).
- The toggle must be keyboard-accessible.
- No new npm dependencies.

## Done When

- A theme toggle button appears in the web UI header.
- Dark mode applies a coherent dark color scheme to all panels.
- The preference is saved to `localStorage` and restored on reload.
- Existing web UI tests pass; at least one test checks that the theme toggle function toggles the expected class.
