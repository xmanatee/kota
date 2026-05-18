---
id: task-read-openai-swe-bench-verified-retirement-post-whe
title: Read OpenAI SWE-bench Verified retirement post when fetchable
status: backlog
priority: p3
area: research
summary: Read OpenAI's SWE-bench Verified retirement post and record a KOTA decision once the rendered-browser source-access enabler is complete
depends_on: [task-enable-autonomous-access-to-auth-walled-sources-so]
created_at: 2026-04-20T20:18:43.712Z
updated_at: 2026-05-18T07:10:06Z
---

## Problem

The OpenAI Research Distillation in `src/modules/autonomy/AGENTS.md` covers
three of the four autonomy-eval-adjacent OpenAI threads named on the watchlist
(instruction hierarchy, CoT monitorability, Model Spec). The fourth - "Why we
no longer evaluate on SWE-bench Verified" - was attempted during the
distillation run (`.kota/runs/2026-04-20T20-14-07-304Z-builder-t2euna/`) but
every fetch path tested returned HTTP 403:

- `WebFetch https://openai.com/index/why-we-no-longer-evaluate-on-swe-bench-verified/`
- `curl -A 'Mozilla/5.0 ...' https://openai.com/index/the-instruction-hierarchy/`
- `web.archive.org` (blocked by harness)
- `kagi.com`, `google.com`, `duckduckgo.com` search redirects (consent walls,
  no usable snippet)

OpenAI's research index is CF-JS-gated. There is no mirror on arXiv, GitHub,
or the SWE-bench project site for this specific OpenAI position post.

The existing eval-harness stance ("fixtures come from real `.kota/runs/`
failures, not synthetic specs") is consistent with the directional signal,
but the post's actual rationale and any concrete recommendations have not
been read against KOTA.

## Desired Outcome

The post is fetched and read, then either:

- Folded into the existing OpenAI Research Distillation entry as a fourth
  decision-level takeaway (adopt / reject / defer + KOTA subsystem touched),
  or
- Honestly recorded as "read, no action" if the post does not change a KOTA
  decision.

If the post surfaces a concrete eval-harness gap, a follow-up implementation
task is opened in `data/tasks/backlog/`.

## Constraints

- Waiting on a usable fetch path for `openai.com/index/*`. Browser-paste of
  the post body is acceptable; do not infer content from third-party
  summaries.
- Do not silently delete or merge this task into the existing distillation
  entry without reading the post.
- Keep the resulting takeaway short and decision-focused per the parent
  task's distillation conventions.

## Done When

- The post is read against KOTA's eval-harness design.
- The OpenAI Research Distillation entry in `src/modules/autonomy/AGENTS.md`
  either gains a fourth decision-level takeaway or records the post as
  "read, no action".
- Any KOTA-specific gap surfaced has a concrete follow-up task opened.

## Source / Intent

This task came from research distillation work that could not honestly read a
Cloudflare-gated OpenAI source. It preserves the missing source as a real
blocked input so KOTA does not infer conclusions from surrounding summaries.

## Initiative

Evidence-grounded autonomy research: KOTA's eval-harness decisions should be
based on read primary sources, and gated primary sources should stay blocked
until a rendered-browser path can read them.

## Acceptance Evidence

- The article body is captured through a valid browser/read path or equivalent
  operator-provided source text.
- `src/modules/autonomy/AGENTS.md` records a concise decision-level takeaway or
  an explicit "read, no action" note.
- Any concrete KOTA gap from the post is converted into a normalized task.

## Status (2026-04-22 retry)

A fresh retry via plain `WebFetch` still returns HTTP 403; `openai.com/index/*`
remains Cloudflare/JS-gated. The scoped `rendered_article_read` tool shipped
under `task-enable-autonomous-access-to-auth-walled-sources-so` drives
Playwright through navigation + network-idle + readable-article extraction and
is the intended unblock path, but requires Playwright to be installed as a
peer (`pnpm add playwright`) in the operator's environment. The research-retry
autonomy workflow will re-attempt this URL once the browser module runs with a
configured environment; until then this task stays dependency-waiting in
`backlog/`.

## Status (2026-05-07 blocker audit)

The dependency is still real. The enabler's precondition now requires a live
authenticated/rendered-browser source-access capture, not merely the Playwright
package resolving. This task stays blocked on that enabler reaching `done/`;
once it does, the post should be read through `rendered_article_read` and
distilled into `src/modules/autonomy/AGENTS.md`.

## Status (2026-05-18 dependency repair)

This task now declares its hard predecessor in `depends_on` and has moved out
of `blocked/`; the typed dependency edge is the scheduler-visible wait. The
required live `rendered_article_read` evidence is still absent, so this task
remains dependency-waiting in `backlog/` and no eval-harness decision note is
recorded from this repair run.
