# Web UI

This directory contains the lightweight web UI client, rendering, and styling helpers.

- Keep UI concerns here and avoid leaking server or workflow logic into presentation code.
- Favor clear rendering behavior over framework-heavy abstractions.
- `client.ts` and `styles.ts` are assembly files that compose section modules (`client-*.ts`, `styles-*.ts`) into the final `WEB_UI_JS` / `WEB_UI_CSS` exports. Add new UI behaviour in a focused section module rather than growing the assemblers. Key sections: `client-sessions.ts` (session list + history panel), `client-chat.ts` (message rendering + send), `client-workflows.ts` (workflow controls), `client-run-detail.ts` (run detail + step progress), `client-tasks.ts`, `client-approvals.ts`, `client-cost.ts`, `client-utils.ts`.
