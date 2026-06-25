# Continuity Surface Run Notes

## Sources Rechecked

- OpenAI overview: https://openai.com/index/codex-maxxing-long-running-work/
- OpenAI whitepaper: https://cdn.openai.com/pdf/8a9f00cf-d379-4e20-b06f-dd7ba5196a11/OAI_WhitePaper_Codex-maxxing26.pdf
- Jason Liu article: https://jxnl.co/writing/2026/05/10/codex-maxxing/

Processed fetch/read evidence is recorded in `source-recheck-evidence.md`.
The implementation maps the durable-work guidance onto KOTA's existing daemon
contract: active work, memory/knowledge review hints, recurring follow-ups,
remote unblock points, and run artifact review.

## Existing Stores Composed

- `tasks.list`
- `workflow.status`
- `workflow.listRuns`
- `workflow.listDefinitions`
- `approvals.list`
- `ownerQuestions.list`
- `ownerDecisions.list`
- `setup.list`
- `memory.list`
- `knowledge.list`

`buildSharedUiSurfaceBundle` reads these through `ctx.client` namespace calls,
wraps each result as a typed `SurfaceRead`, and builds a shared
`ui.surface.v1` continuity surface. The continuity projection and surface do
not add a workstream store or parse `.kota/` files directly.

## Rendered Evidence

- `render-continuity-fixtures.ts` builds healthy, blocked, and failed fixture
  projections with the production continuity builder and shared UI renderer.
- `continuity-rendered-transcript.txt` is the generated CLI transcript. It
  shows:
  - healthy state with active work, a success run artifact link, memory and
    knowledge hints, and a recurring `daily-digest` follow-up;
  - blocked state with a blocked task, approval, owner question, owner
    decision, setup requirement, and concrete refresh/open actions;
  - failed state with the failed-run next action and
    `/api/workflow/runs/<id>/artifacts` link.

## UI Audit

The normal web UI audit skill does not map directly to this text-rendered
shared surface: there is no CSS, browser layout, image asset, animation, or
theme token surface in this change. A contract-level audit was applied instead.

| Dimension | Result | Notes |
| --- | --- | --- |
| Accessibility/readability | Pass | Uses semantic `ui.surface.v1` nodes (`status-summary`, `table`, `list`, `empty`, `action-list`) and role-coded status entries; the transcript remains readable without relying only on color labels. |
| Performance | Pass | Projection is bounded with small slices for work, unblocks, artifacts, hints, and follow-ups. No unbounded artifact or prompt content is rendered. |
| Sensitive data handling | Pass | Projection runs visible text through `redactSensitiveText`; tests assert raw token and email strings do not render. |
| Responsive/client contract | Pass | The shared surface is consumed through the daemon UI contract, leaving actual phone/desktop layout to thin clients. Rows and details are concise and route deep inspection to existing views. |
| Anti-patterns | Pass | No decorative CSS, no card grids, no gradients, no new visual assets, and no parallel runtime primitive. |

Residual limitation: memory/knowledge entries are surfaced as review hints from
the existing list APIs. If those stores later expose structured diff metadata,
the projection can display it without changing the surface contract.

## Workflow Note

`pnpm kota task move task-improve-long-running-work-continuity-surfaces done`
was attempted, but failed when `git mv` could not create `.git/index.lock`
inside this sandbox. The task file was moved to `done/` and updated manually in
the worktree with the same state transition.
