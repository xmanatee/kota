---
id: task-review-owner-captured-automated-research-and-mimo-
title: Review owner captured automated research and MiMo links
status: blocked
priority: p2
area: research
summary: Read and disposition the owner-captured 2026-06-10 bare links on automated AI research, OpenAI ONA, and Xiaomi MiMo for KOTA relevance without inferring from unread sources.
created_at: 2026-06-13T00:16:08.543Z
updated_at: 2026-06-20T20:59:59.863Z
---

## Problem

The owner-provided 2026-06-10 research bundle ended with bare URLs that were
not researched in the capture. Leaving them in `data/inbox/` keeps the inbox as
a second queue, but folding them into completed research would violate KOTA's
source-access honesty rule.

## Desired Outcome

Read the listed sources and decide whether each produces a KOTA action:
adopted with a bounded task, deferred with a named follow-up, reference-only
with a short rationale, or dropped after reading.

## Constraints

- Treat every listed URL as unread until its actual content has been fetched or
  operator-provided.
- Do not infer conclusions from titles, snippets, launch framing, or vendor
  reputation.
- If a source is inaccessible, record the blocker honestly instead of marking
  it processed.
- Avoid watchlist bloat; add ongoing resource surfaces only when they will
  continue producing useful signal, not for one-off articles.
- Keep any resulting work mapped to KOTA's existing concepts: module, client,
  workflow, channel, tool, setup requirement, store, daemon, scope, or eval
  fixture.

## Done When

- Every URL below has a disposition based on read content.
- Any KOTA-relevant idea is mapped to an existing concept or a normalized
  follow-up task.
- If no action is needed, this task records "read, no action" with a concise
  reason.

## Source / Intent

Owner-provided 2026-06-10 inbox bundle asked KOTA to research agent ecosystem
links and keep only useful ideas. The following trailing links were captured
without research notes:

- https://www.recursive.com/articles/first-steps-toward-automated-ai-research
- https://alignment.anthropic.com/2026/automated-w2s-researcher/
- https://openai.com/index/openai-to-acquire-ona/
- https://mimo.xiaomi.com/
- https://mimo.xiaomi.com/blog/mimo-code-long-horizon
- https://github.com/XiaomiMiMo/MiMo-Code

## Initiative

Evidence-grounded external research for KOTA autonomy, evaluation, and
agent-runtime design.

## Acceptance Evidence

- Research notes or the task body record a disposition for each source with
  the access method used.
- Any created follow-up tasks are named.
- `pnpm run validate-tasks -- --min-ready 0` passes.

## Research Notes

Attempted on 2026-06-20.

- `https://www.recursive.com/articles/first-steps-toward-automated-ai-research`
  - Access method: direct browser fetch via `web.open`.
  - Disposition: read, no action; reference-only for autonomy/eval design.
  - KOTA mapping: workflow/eval fixture/critic calibration. The source's
    useful signals are automated experiment loops, many parallel research
    threads, artifact open-sourcing, cross-task pattern reuse, and increasingly
    strict correctness audits against reward hacking. KOTA already captures the
    matching durable decisions through generator/evaluator separation,
    artifact-first critic input, runtime probes, eval fixtures, and reward-hack
    calibration notes in the autonomy docs. No bounded, non-duplicative task was
    opened.
- `https://alignment.anthropic.com/2026/automated-w2s-researcher/`
  - Access method: direct browser fetch via `web.open`.
  - Disposition: read, no action; reference-only for research workflow shape.
  - KOTA mapping: workflow/eval fixture/autonomy coordination. The source's
    useful signals are parallel sandboxes with externalized logs, directed
    ambiguous research directions to prevent entropy collapse, held-out
    generalization checks, and concrete reward-hacking examples. KOTA already
    rejects prompt-only self-reflection, keeps durable evidence in artifacts,
    avoids worktree-based builder parallelism, and documents reward-hacking and
    held-out fixture concerns in the autonomy/eval guidance. No new task or
    watchlist entry is justified from this one article.
- `https://openai.com/index/openai-to-acquire-ona/`
  - Access method: direct browser fetch via `web.open`.
  - Disposition: read, no action; reference-only for persistent execution
    posture.
  - KOTA mapping: daemon/session/scope/setup requirement/secrets/guardrails.
    The article describes customer-controlled persistent execution, scoped
    credentials, logging, review, and long-running agent work. KOTA's current
    architecture already routes this through daemon-hosted sessions, scopes,
    setup requirements, secret stores, guardrails, and client control surfaces.
    No new KOTA primitive or task is needed.
- `https://mimo.xiaomi.com/`
  - Access method: direct browser fetch via `web.open`.
  - Disposition: read, no action.
  - KOTA mapping: model-client/harness watch signal only. The page is a product
    and blog index for MiMo models, API access, and MiMo Code. It does not add a
    bounded KOTA action beyond the separately listed MiMo Code sources. No
    watchlist entry was added to avoid broad vendor-homepage bloat.
- `https://mimo.xiaomi.com/blog/mimo-code-long-horizon`
  - Access method: attempted direct browser fetch via `web.open`, exact web
    search for the URL/title, `https://mimo.xiaomi.com/blog`, and local `curl`
    probes. The direct URL produced no readable page content in `web.open`;
    exact web search found no indexed copy; local `curl` could not resolve the
    host from this sandbox. The blog index currently returns a different
    MiMo-V2-Flash article, not this long-horizon article.
  - Disposition: blocked, not processed. This task cannot honestly mark the URL
    read without operator-provided content or a reachable snapshot.
- `https://github.com/XiaomiMiMo/MiMo-Code`
  - Access method: direct browser fetch via `web.open`, plus the raw GitHub
    README.
  - Disposition: read, no action; reference-only for peer coding-agent surface.
  - KOTA mapping: agent/harness/skill/memory/client. The repository describes a
    terminal-native coding assistant with build/plan/compose agents, provider
    configuration, persistent project memory, subagents, and use restrictions.
    These map to existing KOTA concepts and duplicate already tracked peer CLI
    surfaces such as Codex, Claude Code, Gemini CLI, OpenHands, and Mini
    SWE-agent. No normalized follow-up task was opened.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-06-20T20-54-52-875Z-builder-2jwlhx/source-access/mimo-code-long-horizon.md
description: operator-provided readable content, screenshot transcript, or reachable snapshot for https://mimo.xiaomi.com/blog/mimo-code-long-horizon so the MiMo Code long-horizon source can be dispositioned without inferring from unread content
```

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-08-23T03:37:59.106Z -->
