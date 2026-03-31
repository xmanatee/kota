# Web UI

This directory contains the lightweight web UI client, rendering, and styling helpers.

- Keep UI concerns here and avoid leaking server or workflow logic into presentation code.
- Favor clear rendering behavior over framework-heavy abstractions.
- `client.ts` and `styles.ts` are assembly files that compose section modules (`client-*.ts`, `styles-*.ts`) into the final `WEB_UI_JS` / `WEB_UI_CSS` exports. Add new UI behaviour in a focused section module rather than growing the assemblers. Key sections: `client-sessions.ts` (chat session list and conversation history — not the daemon sessions panel), `client-active-sessions.ts` (live daemon sessions panel showing active `kota serve` sessions from `GET /api/daemon/status`), `client-chat.ts` (message rendering + send), `client-workflows.ts` (workflow controls + history filter), `client-run-detail.ts` (run detail + step progress), `client-tasks.ts`, `client-approvals.ts`, `client-cost.ts`, `client-schedules.ts` (schedules panel showing workflows with cron/interval triggers, next-run time, and last-run status from `GET /api/workflow/status` + `GET /api/workflow/definitions`), `client-utils.ts`.

## Filter Pattern

When adding client-side filters to a panel: (1) keep filter state in plain JS variables, (2) add an `apply<Panel>Filter()` function that reads state and calls the renderer with filtered data, (3) add a `render<Panel>Filter(names)` that rebuilds the filter bar and restores values from state, (4) store the full fetched dataset in a module-level array so filters work without re-fetching. The `#workflow-history-filter` element in the Workflows section is the reference implementation.
