---
id: task-enable-autonomous-access-to-auth-walled-sources-so
title: Enable autonomous access to auth-walled sources so blocked research tasks can unblock
status: blocked
priority: p2
area: architecture
summary: Give autonomy a reliable path to read auth-walled or JS-gated sources (X/Twitter, openai.com/index, etc.) via authenticated browser automation plus a scoped X-post capture tool, so 'inaccessible source' tasks do not stay blocked indefinitely.
created_at: 2026-04-22T16:47:00.746Z
updated_at: 2026-05-26T04:58:00Z
---

## Problem

`task-review-inaccessible-research-resources-when-access` and
`task-read-openai-swe-bench-verified-retirement-post-whe` are both blocked on
sources that `WebFetch` and `curl` cannot read: X/Twitter posts (HTTP 402 auth
wall), Cloudflare-JS-gated research pages like `openai.com/index/*`, and JS-
rendered article pages. The policy introduced by
`task-make-source-access-failures-first-class` stops autonomy from silently
marking these tasks done, but it does not provide a way forward. As a result,
real research leads sit indefinitely without being read, and fresh captures
like `https://x.com/pedroh96/status/2046604993982009825` pile onto the same
blocked task.

The `browser` module already provides Playwright-based automation. What is
missing is a reliable, operator-scoped flow for reaching auth-walled or
JS-gated sources end-to-end: a persistent logged-in browser profile, a scoped
tool that extracts X-post (and similar) content cleanly, and a repair/unblock
loop that reruns blocked research when such sources become reachable.

## Desired Outcome

Autonomy has a deterministic path to resolve inaccessible-source blockers. An
operator registers authenticated browser profiles (or per-host login flows)
behind the existing credentials surface; a scoped tool reads X posts, OpenAI
index pages, and similar sources via that profile and returns clean text
through the injection-defense boundary. Blocked research tasks whose resources
become reachable get picked up and progressed automatically; tasks that remain
inaccessible retain honest blocked status.

## Constraints

- Build on the existing `browser` module; do not add a parallel browser stack.
- Credentials live behind the standard secrets/config surface — no committed
  cookies, tokens, or profile files.
- Web content entering agent context must go through `injection-defense`. Do
  not create an exception for authenticated-browser output.
- Keep the X/Twitter path as a thin scoped tool (read a post, read its
  replies/thread) rather than a general-purpose X API client. A wider X
  capability should be a follow-up task, not scope creep here.
- Authenticated-browser capability is `dangerous`-class; tool risk gating,
  approval surface, and autonomy-mode rules must continue to apply.
- Do not skip robots/TOS constraints. If reading a source requires violating
  vendor terms, document it and route through operator approval, not autonomy
  default.
- No backwards-compatibility shim that leaves the old "just fail loudly" path
  as a silent fallback for sources this task claims to cover.

## Done When

- An authenticated browser profile / login flow is configurable through the
  secrets surface and exercised by at least one integration test against a
  representative auth-walled host.
- A scoped tool extracts X-post content (post body plus thread context) end-
  to-end, returning text through `injection-defense` and covered by tests that
  include both a successful read and an unreachable / rate-limited failure.
- `openai.com/index/*` and similar JS-gated article pages are reachable via
  the same authenticated/rendered-browser path, again with tests.
- An autonomy workflow (existing or new) picks up blocked research tasks whose
  sources are now reachable, reads them, and either completes or updates them
  honestly. At minimum, the two tasks named in Problem are unblocked through
  this mechanism and either completed or repositioned with fresh honest
  status.
- The mechanism is documented at the narrowest applicable `AGENTS.md` (most
  likely under `src/modules/browser/` or a new sibling), not duplicated across
  docs.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/auth-walled-source-access-live
description: live authenticated-browser source-access artifact — operator installs Playwright in the target environment, provisions modules.browser.storageStatePath for an authenticated profile, runs `kota browser source-access-report --run-id auth-walled-source-access-live --article-url <OpenAI post URL> --x-url <listed X status URL>`, and stores the generated source-access-report.json, source-access-summary.md, and source-access-transcript.txt under .kota/runs/auth-walled-source-access-live/
```

## Source / Intent

Owner inbox captures included X/Twitter and gated research links that should
not remain permanently blocked or be silently dropped. This task exists because
source-access failures must become a recoverable capability gap, not recurring
research-retry churn.

## Initiative

Recoverable research access: KOTA should honestly distinguish inaccessible
sources from resolved sources and should automatically progress blocked
research once the operator provides the required browser capability.

## Acceptance Evidence

- Browser-module tests exercise successful rendered/authenticated reads and
  unreachable/rate-limited failures through the injection-defense boundary.
- Research-retry run artifacts show at least one previously blocked task being
  retried through the browser path and either completed or kept blocked with
  fresh evidence.
- Operator setup requirements are recorded in the narrow module/workflow
  instructions, with no committed credentials or silent fallback path.

## Status (2026-04-22 build)

Mechanism landed in this repo:

- Authenticated browser profile: `modules.browser.storageStatePath`
  (optional `persistProfile`) is threaded through a new
  `playwright-loader.ts` + reshaped `lifecycle.ts` into
  `browser.newContext({ storageState })`. Covered by five lifecycle tests
  driving Playwright-intercepted mock auth-walled hosts.
- Scoped X-post tool: `x_post_read` in `src/modules/browser/tools.ts` with
  URL whitelist, auth-gate / rate-limit / login-redirect / missing-article /
  timeout failure envelopes. Seven `index.test.ts` cases cover success and
  each failure mode.
- JS-gated article path: `rendered_article_read` with `<article>`/`<main>`
  preference, fallback-body extraction, optional custom selector, timeout,
  and Cloudflare-JS gate detection. Six `index.test.ts` cases.
- Injection-defense extended: `browser_get_text`, `x_post_read`, and
  `rendered_article_read` added to `DEFAULT_TARGET_TOOLS` with an asserting
  test.
- Autonomy workflow: `src/modules/autonomy/workflows/research-retry/`
  (workflow.ts, candidates.ts, prompt.md, AGENTS.md, workflow.test.ts)
  wakes from `autonomy.blocked-research.attemptable`, selects the oldest
  blocked task with a `## Resources` URL section, and runs the agent with
  the candidate info exposed via `exposeOutputToAgent`.
- Named tasks repositioned with fresh honest status: the review task now
  records two URLs as now-readable and dispositioned (helm article,
  arxiv 2511.18423) and six as still auth-walled / 404; the OpenAI SWE-bench
  post task records the still-403 state on plain fetch plus the
  rendered-browser unblock path.
- Docs: `src/modules/browser/AGENTS.md` covers the profile contract, the
  three content-ingest tools, and failure modes;
  `src/modules/autonomy/workflows/research-retry/AGENTS.md` covers the
  workflow.

### Remaining operator steps

- Install Playwright as a peer in the target environment. Until installed,
  rendered-browser tools fail fast with the existing "Playwright is not
  installed" error.
- Provision an authenticated X profile (run once with `persistProfile: true`,
  log in interactively, then pin the file path).
- Capture `.kota/runs/auth-walled-source-access-live/` containing the redacted
  capability report generated by `kota browser source-access-report --run-id
  auth-walled-source-access-live --article-url <OpenAI post URL> --x-url
  <listed X status URL>`. The generated JSON, summary, and transcript should
  show one successful `rendered_article_read` against the OpenAI post and one
  successful `x_post_read` against the listed X-post set.
- Once that capture exists, blocked-promoter can promote this task for final
  verification; after it moves to `done`, the two dependent research tasks
  unblock through their `task-done` preconditions.

## Status (2026-05-25 inbox sorter)

Rechecked the X/Twitter processing path while sorting
`data/inbox/task-assess-and-complete-x-com-link-processing-support.md`.
`src/modules/browser/AGENTS.md` still names `x_post_read` as the scoped
X/Twitter status reader and the authenticated browser profile as the required
operator capability. The current local environment cannot exercise it:
`pnpm exec playwright --version` reports the command missing,
`import('playwright')` fails with `ERR_MODULE_NOT_FOUND`, and no
`modules.browser.storageStatePath` setting was found in local `.kota` config.

The new 2026-05-25 owner resource batch contains three X status URLs. They are
tracked in
`task-review-owner-resource-batch-from-2026-05-25-for-ko`; they must be read
through `x_post_read` when the operator capability exists or recorded as
auth-walled with the same retry condition. No separate X-support task is needed
today; the remaining blocker is still this task's operator-capture
precondition.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-05-07T12:27:35.000Z -->
