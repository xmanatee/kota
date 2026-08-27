---
status: done
---

# Add light/dark theme toggle to the web UI dashboard

## Problem

The KOTA web UI (`src/web-ui/`) uses a single dark color scheme (CSS custom properties in `styles-layout.ts`: `--bg: #1a1a2e`, `--text: #e0e0e0`, etc.) with no light variant. Operators using the dashboard in brightly lit environments or who prefer a light theme have no option. The preference should persist across page reloads.

## Desired Outcome

A light/dark mode toggle in the web UI header (icon button). Clicking it:
- Adds or removes a `light` CSS class on `<body>` (dark is the default).
- Saves the preference to `localStorage` (`kota.theme: "dark" | "light"`).
- Restores the preference on page load.

Light mode colors should cover the main background, sidebar, panels, chat messages, and text. Use CSS custom properties (already in use) so the light theme is a single override block rather than scattered overrides.

## Constraints

- Follow the existing module pattern in `src/web-ui/`: add CSS in a new `styles-theme.ts` and toggle logic in a dedicated `client-theme.ts`.
- Keep changes self-contained to the web UI layer; do not touch server routes.
- Accessible contrast ratios: text on background must meet WCAG AA (4.5:1 for normal text) in both themes.
- The toggle must be keyboard-accessible.
- No new npm dependencies.

## Done When

- A theme toggle button appears in the web UI header.
- Light mode applies a coherent light color scheme to all panels.
- The preference is saved to `localStorage` and restored on reload.
- Existing web UI tests pass; at least one test checks that the theme toggle function toggles the expected class.
