---
id: task-enable-autonomous-access-to-auth-walled-sources-so
title: Enable autonomous access to auth-walled sources so blocked research tasks can unblock
status: backlog
priority: p2
area: architecture
summary: Give autonomy a reliable path to read auth-walled or JS-gated sources (X/Twitter, openai.com/index, etc.) via authenticated browser automation plus a scoped X-post capture tool, so 'inaccessible source' tasks do not stay blocked indefinitely.
created_at: 2026-04-22T16:47:00.746Z
updated_at: 2026-04-22T16:47:00.746Z
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
