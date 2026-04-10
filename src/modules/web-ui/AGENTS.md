# Web UI

This directory contains the lightweight web UI client, rendering, and styling helpers.

- Keep UI concerns here and avoid leaking server or workflow logic into presentation code.
- Favor clear rendering behavior over framework-heavy abstractions.
- `client.ts` and `styles.ts` are assembly files that compose section modules (`client-*.ts`, `styles-*.ts`) into the final `WEB_UI_JS` / `WEB_UI_CSS` exports. Add new UI behaviour in a focused section module rather than growing the assemblers.

## Responsive Layout

The layout adapts at two breakpoints defined in `styles-layout.ts`:
- **≤768px (tablet)**: the sidebar becomes a fixed overlay that slides in/out. `#mobile-menu-btn` (hidden on desktop) and `#sidebar-overlay` (backdrop) are rendered in `web-ui.ts`. `client.ts` wires their click handlers and auto-collapses the sidebar on load when `window.innerWidth <= 768`.
- **≤480px (mobile)**: single-column layout, no horizontal overflow.

Desktop layout (≥900px) is unchanged. When adding new layout changes, keep media queries in `styles-layout.ts`; keep sidebar toggle JS in `client.ts` rather than individual section modules.

## SSE Reconnect Pattern

`connectDaemonEvents()` in `client-workflows.ts` tracks `_lastEventTimestamp` and appends `since=<timestamp>` to the `EventSource` URL on reconnect so the daemon ring buffer replays missed events immediately. Every new SSE event listener added inside `connectDaemonEvents` **must** be wrapped with `_trackEvent(handler)` — this updates `_lastEventTimestamp` on each event and ensures the reconnect window covers all event types. Omitting the wrapper means events of that type will not advance the timestamp, and catchup after reconnect may replay duplicates or miss events depending on event ordering.

## Filter Pattern

When adding client-side filters to a panel: (1) keep filter state in plain JS variables, (2) add an `apply<Panel>Filter()` function that reads state and calls the renderer with filtered data, (3) add a `render<Panel>Filter(names)` that rebuilds the filter bar and restores values from state, (4) store the full fetched dataset in a module-level array so filters work without re-fetching. The `#workflow-history-filter` element in the Workflows section is the reference implementation.
