---
id: task-expand-explorer-watchlist-with-high-quality-extern
title: Expand explorer watchlist with high-quality external resources
status: backlog
priority: p2
area: autonomy
summary: Current watchlist is shallow with only four entries; research and add well-maintained resources from peer projects (pi-mono, openclaw, zeroclaw, openfang), vendor research (Anthropic, Google, Vercel), and representative agent-research papers so explorer runs surface more external signal.
created_at: 2026-04-19T19:40:24.397Z
updated_at: 2026-04-19T19:40:24.397Z
---

## Problem

`data/watchlist.yaml` currently tracks only four resources (openclaw,
zeroclaw, openfang, pi-mono). Explorer runs therefore surface the same
narrow set of external signals on every pass. The owner captured that
the list is shallow and asked for a deliberate expansion across the
broader agent ecosystem.

Sources the owner called out or hinted at:

- Peer agent runtimes and orchestration frameworks (beyond the four
  already tracked — e.g. additional open-source personal-assistant and
  agent-OS projects such as manus and similar).
- Research and engineering output from relevant vendors: Anthropic,
  Google (DeepMind, research blog), Vercel (AI SDK and agent work).
- Representative, high-signal research papers in agent autonomy, tool
  use, long-horizon planning, and evaluation.

"Shallow" here means breadth, not count — new entries should pull their
weight as durable signal sources, not pad the list.

## Desired Outcome

- A meaningfully broader watchlist that covers peer runtimes, vendor
  research surfaces, and representative research output relevant to
  KOTA's design concerns (multi-agent orchestration, autonomy, memory,
  guardrails, long-running workflows).
- Each new entry is reachable, well-maintained, and produces durable
  external signal the explorer can actually consult across runs.
- Inaccessible or low-signal candidates are recorded honestly (dropped,
  or marked `status: inaccessible`) rather than silently skipped.
- The watchlist shape remains the existing YAML under `data/`; no new
  sidecar store or parallel catalog.

## Constraints

- `data/watchlist.yaml` stays human-editable; new entries follow the
  existing per-entry shape (`url`, `added`, and the machine-managed
  `snapshot` fields set by explorer).
- Do not add aggregator indexes or link dumps as entries (e.g. "awesome-
  *" lists) just to inflate coverage — prefer specific projects, blogs,
  or paper-series pages that update on their own cadence.
- Respect the inaccessible-source rule: if a candidate URL cannot be
  fetched at add time, record it honestly — do not silently drop it.
- Do not leak agent-facing cost signals into autonomy through watchlist
  metadata.
- Keep durable guidance close to the watchlist (`data/AGENTS.md` or a
  scoped note) rather than restating policy in the YAML.

## Done When

- `data/watchlist.yaml` picks up a substantively broader set of entries
  across the categories above, each with a clear reason to be on the
  list (implicit in choice of URL; no per-entry prose needed).
- Inaccessible candidates surface with `status: inaccessible` or are
  explicitly dropped with a short note in the capture trail.
- The explorer prompt and workflow continue to consult the watchlist
  without code changes (this task is curation, not a runtime change).
- A follow-up task is opened if any candidate category reveals a real
  gap in the watchlist shape (e.g. needs per-entry tags or category
  grouping); this task does not itself reshape the YAML schema.
