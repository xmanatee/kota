---
id: task-add-a-browser-source-access-capability-report-for-
title: Add a browser source-access capability report for authenticated research unblock
status: done
priority: p2
area: modules
summary: Add a module-owned readiness/report surface that verifies Playwright and browser profile wiring, exercises rendered/X source reads through the existing tools, and writes the redacted capability report required to unblock auth-walled research tasks.
created_at: 2026-05-26T04:49:45.211Z
updated_at: 2026-05-26T05:03:00Z
---

## Problem

`task-enable-autonomous-access-to-auth-walled-sources-so` is blocked on a live
operator capture that includes a "redacted transcript plus capability report."
The browser module already has the important primitives (`rendered_article_read`,
`x_post_read`, `modules.browser.storageStatePath`, optional Playwright loading),
and research-retry has a coarse preflight for Playwright/profile availability.
What is missing is a first-class operator surface that turns those pieces into
the exact artifact the blocker asks for.

Today an operator has to manually inspect config, run one or more browser
tools, remember what must be redacted, and assemble an evidence directory by
hand. That keeps the auth-walled research blocker real but makes the unblock
path vague and error-prone.

## Desired Outcome

A module-owned source-access readiness/report command, tool, or equivalent
operator surface exists for the browser module. It verifies the configured
browser capability, exercises the existing scoped source readers, and writes a
redacted report under a run directory that an operator can attach directly to
the auth-walled-source unblock precondition.

The report should answer, without exposing credentials:

- Does Playwright resolve in this project runtime?
- Is `modules.browser.storageStatePath` configured?
- Does the resolved storage-state file exist?
- Is profile persistence enabled or disabled?
- Did `rendered_article_read` succeed against the requested JS-rendered article
  URL?
- Did `x_post_read` succeed against the requested X/Twitter status URL?
- If either read failed, was the failure missing capability, auth wall, JS gate,
  timeout, rate limit, or another typed failure?

The surface should support the current live unblock shape while also being
useful before credentials exist: a no-capability run should emit a clear
actionable report instead of forcing the operator to infer the missing setup.

## Constraints

- Reuse the existing browser module and scoped reader tools. Do not add a second
  browser stack, a general scraping client, or a parallel source-access
  protocol.
- Keep Playwright optional. This work must not add Playwright to required
  project dependencies or make ordinary KOTA installs heavier.
- Never print or persist cookies, localStorage values, bearer tokens, raw
  storage-state JSON, or full auth-walled source bodies in the capability
  report. Include sanitized excerpts only when needed to prove the correct
  page rendered.
- Browser-derived text still enters through the existing injection-defense
  path. Do not create a special unscreened report path for authenticated
  content.
- Tests must not hit live OpenAI or X/Twitter. Use mocked Playwright/tool
  outcomes or local fixtures for success/failure coverage; live vendor reads
  remain operator-captured evidence.
- Keep the existing blocked task honest. This task can clarify its operator
  instructions once the report surface exists, but it must not mark the blocked
  task done or silently weaken the required live capture.

## Done When

- The browser module exposes an operator-runnable source-access capability
  report surface reachable through the existing CLI/module command pattern or
  another established operator path.
- The report writes a machine-readable JSON artifact and a human-readable
  transcript/summary under `.kota/runs/<run-id>/...`, with credential-bearing
  values redacted.
- The surface checks Playwright availability, browser profile configuration,
  profile file existence, and `persistProfile` state before attempting live
  reads.
- The surface can run `rendered_article_read` and `x_post_read` against
  operator-supplied URLs and records typed success/failure outcomes for each.
- Focused tests cover at least: no Playwright installed, profile path missing,
  profile file missing, rendered article success, X-post auth-wall failure, and
  fully successful mocked report generation.
- `task-enable-autonomous-access-to-auth-walled-sources-so` is updated to name
  the new command/report path as the canonical way to produce its capability
  report, without changing its blocked status unless the live artifact actually
  exists.
- Any narrow `AGENTS.md` guidance under `src/modules/browser/` is updated only
  if the operator contract changes.

## Source / Intent

Explorer run `2026-05-26T04-47-51-544Z-explorer-w8753v` reviewed an empty
actionable queue. The strategic blocked alternatives were all
operator-capture waits and not movable. The auth-walled source-access blocker
is still real, but inspection showed a decomposable gap: the task asks for a
"capability report" while the browser module exposes only the underlying tools
and coarse preflight checks.

Relevant local evidence:

- `data/tasks/blocked/task-enable-autonomous-access-to-auth-walled-sources-so.md`
  requires `.kota/runs/auth-walled-source-access-live/` to contain a redacted
  transcript plus capability report.
- `src/modules/browser/AGENTS.md` documents the authenticated browser profile
  contract and the scoped content-ingest tools.
- `src/modules/autonomy/workflows/research-retry/precondition.ts` can detect
  Playwright/profile availability, but it is a workflow preflight, not an
  operator-facing artifact generator.

This is a decomposition of the existing strategic blocker, not a new source
access primitive.

## Initiative

Recoverable research access: KOTA should give operators a concrete, redacted,
repeatable path to prove authenticated/rendered browser capability so blocked
research can progress without guessing or ad-hoc evidence assembly.

## Acceptance Evidence

- Diff showing the browser-module report surface and focused tests.
- Transcript captured under `.kota/runs/<run-id>/` for the no-capability path
  in this sandbox, showing the missing Playwright/profile checks and actionable
  next steps.
- Test fixture or mocked-run artifact showing a successful report with both a
  rendered article read and an X-post read recorded without credential leakage.
- `pnpm test` invocation for the affected browser/report tests.
- `pnpm kota validate-queue` or equivalent task validation showing the updated
  ready task and clarified blocked task still pass.

## Completion Evidence

- Browser report surface: `kota browser source-access-report`.
- No-capability transcript:
  `.kota/runs/2026-05-26T04-51-52-278Z-builder-vdw5ve/no-capability-source-access/source-access-transcript.txt`.
- Mock successful report:
  `.kota/runs/2026-05-26T04-51-52-278Z-builder-vdw5ve/mock-success-source-access/source-access-report.json`.
- Focused tests:
  `pnpm test src/modules/browser/cli.test.ts src/modules/browser/source-access-report.test.ts src/modules/browser/index.test.ts`.
- Typecheck/build: `pnpm typecheck`; `pnpm build`.
- Queue validation: `pnpm validate-tasks`.
