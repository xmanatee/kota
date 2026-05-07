---
title: Research "raw → wiki → outputs" Second Brain pattern by @NickSpisak_
created_at: 2026-05-07T16:09:03.000Z
source: owner
---

Owner ask:

> "Process and consume and analyse" this link in the best possible way.

Link:

- https://x.com/NickSpisak_/status/2040448463540830705
- Mirror (the X URL is paywalled to fetchers):
  https://twitter-thread.com/t/2040448463540830705

What it is:

An eight-step recipe for a flat-file personal knowledge base driven by Claude
Code:

1. Three folders: `raw/`, `wiki/`, `outputs/`.
2. Dump all source material (articles, screenshots, notes) into `raw/`.
3. Use `agent-browser` (Vercel Labs CLI, ~26K stars) to scrape web content
   into `raw/` automatically.
4. Author a `CLAUDE.md` in the project that defines the schema and rules
   for the knowledge base.
5. Have Claude Code compile `raw/` into an organized `wiki/` with `INDEX.md`
   and topic files.
6. Iterate: ask the wiki questions, save answers back to strengthen it.
7. Monthly health checks for contradictions and gaps.
8. Tool-agnostic — VS Code, Obsidian, terminal, anything.

Stated philosophy: flat text + clear schema beats complex tool stacks.

Why this matters for KOTA:

- KOTA's `data/` directory is *exactly* this shape at a higher level: rough
  `inbox/` captures, normalized `tasks/`, `watchlist.yaml` for external
  resources, with `AGENTS.md` files acting as the schema. The thread is a
  parallel implementation worth studying for what KOTA may be missing
  (an explicit `outputs/` artifact channel? scheduled health checks?).
- Concrete tool to evaluate: `agent-browser` (vercel-labs) as a possible
  ingestion path for watchlist content. Not a recommendation — an option.
- The "raw → wiki → outputs" separation is a useful framing when arguing
  about whether KOTA should have a separate "researcher" or "analyst" role
  (already an open inbox question).

Suggested daemon disposition:

- Read for analogies, not adoption. The thread is workflow-folklore, not
  primary docs. If anything graduates, it is a comparison note inside an
  existing architecture-shaping capture, not a standalone task.
- Worth a quick look at the `vercel-labs/agent-browser` repo before
  dismissing — if it solves a real ingestion problem KOTA already has, it
  becomes a watchlist candidate (but only the repo, not the thread).
