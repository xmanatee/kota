---
title: Research Vercel's agent-targeted runtime stack (Open Agents + agent-mode CLI)
created_at: 2026-05-07T16:09:03.000Z
source: owner
---

Owner ask:

> "Process and consume and analyse" these links in the best possible way. Decide
> what is worth graduating into a task, a watchlist entry, or a discard.

Three links, grouped because they describe the same Vercel-side story —
Vercel building a hosted runtime + machine-readable CLI surface aimed at
autonomous coding agents.

Links:

- https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents
- https://open-agents.dev/
- https://github.com/vercel-labs/open-agents

What each one is:

- Vercel CLI changelog: new `vercel discover`, `vercel guide`, and `vercel add`
  commands with `--format=json`, designed so an agent can browse marketplace
  integrations, fetch setup instructions in a parseable shape, and install
  them. Human steps (e.g. terms-of-service approval) are preserved as explicit
  decision points in the agent flow.
- `open-agents.dev`: hosted product. "Spawn coding agents that run infinitely
  in the cloud." Built on four primitives: AI SDK (model interface), AI Gateway
  (provider routing/fallbacks), Sandbox (isolated VMs with snapshot/restore),
  and Workflow SDK (durable, resumable orchestration with checkpointing).
- `vercel-labs/open-agents`: open-source reference implementation that powers
  the hosted product. TypeScript, Next.js web app, Vercel Workflows for durable
  execution, Better Auth (Vercel + GitHub OAuth), Postgres for persistence.
  Architecture is "Web → Agent workflow → Sandbox VM" with the agent running
  *outside* the sandbox so model logic and execution env evolve independently.

Why this matters for KOTA:

- The Workflow SDK + Sandbox split is a near-direct parallel to KOTA's own
  workflow/agent split; their durability, snapshot/restore, and "agent outside
  the sandbox" choice are useful comparison points for the events/hooks vs.
  workflows debate already in the inbox.
- The agent-mode CLI pattern (`--format=json`, scripted ToS pauses) is
  generalizable beyond Vercel: any external tool KOTA wants its agents to
  drive could expose a similar surface. Worth mining for what KOTA's own
  external-tool adapters should look like.
- The reference repo is template-shaped — concrete prompts, tool list, branch
  semantics, PR generation — and is a high-signal artifact to read end-to-end.

Suggested daemon disposition:

- Add the open-agents repo and the Vercel Workflows / Sandbox docs as
  watchlist entries (durable, update on their own cadence) — they fit the
  existing watchlist criterion of "peer agent runtimes."
- Graduate a single research task into `data/tasks/` only if a concrete KOTA
  decision depends on it (e.g. revisiting workflow durability, or designing
  KOTA's external-tool agent-mode surface). Do not graduate as a generic
  "read these links" task.
