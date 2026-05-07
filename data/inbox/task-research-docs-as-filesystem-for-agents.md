---
title: Research "docs as a filesystem" tool pattern (Nia / agentsearch.sh)
created_at: 2026-05-07T16:09:03.000Z
source: owner
---

Owner ask:

> "Process and consume and analyse" this link in the best possible way.

Link:

- https://x.com/arlanr/status/2041215978957389908
- Mirror (the X URL is paywalled to fetchers):
  https://twitter-thread.com/t/2041215978957389908

What it is:

A pitch from Arlan Rakhmetzhanov (Nozomio Labs) arguing that traditional RAG
over docs is the wrong abstraction for coding agents, and that documentation
should be exposed as a navigable filesystem the agent can `grep`, `cat`,
`tree`, and `find` — because coding-tuned models have already seen billions
of filesystem interactions. Concretely:

- Doc URLs become file paths.
- A backend crawls and indexes sites and respects `llms.txt`.
- A client-side TypeScript bash interpreter executes commands against an
  in-memory file structure (no containers, no server-side compute per query).
- Surfaced as a tool called Nia (https://trynia.ai) and a demo at
  https://www.agentsearch.sh/.

Why this matters for KOTA:

- KOTA already has external-tool adapters and a workflow story; this is a
  candidate pattern for how KOTA's agents should consume external docs and
  watchlist artifacts (vs. embedding every snippet or relying on web search).
- The `llms.txt` respect + filesystem-shaped tool surface is reusable beyond
  one vendor; the question is whether KOTA wants a generic "doc filesystem"
  tool that wraps watchlist sources, not whether to adopt Nia specifically.
- Aligns with the "agents thrive on familiar interfaces" posture already
  expressed elsewhere in the codebase (typed adapters over ad-hoc shapes).

Suggested daemon disposition:

- Treat as a tool-design idea, not a vendor recommendation. If anything
  graduates, it is a `data/tasks/` capture about whether KOTA should expose
  its watchlist + cached external docs through a uniform filesystem-shaped
  tool surface. Do not add Nia or agentsearch.sh as a watchlist entry —
  vendor product pages do not meet the watchlist criterion of durable,
  self-updating signal.
