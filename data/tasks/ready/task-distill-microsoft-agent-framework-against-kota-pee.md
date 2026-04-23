---
id: task-distill-microsoft-agent-framework-against-kota-pee
title: Distill Microsoft Agent Framework against KOTA peer-runtime primitives
status: ready
priority: p2
area: research
summary: Microsoft Agent Framework is the first-party successor to AutoGen (maintenance-mode) and the single watchlist gap in Microsoft-ecosystem peer-runtime coverage; fetch the repo, capture a snapshot, and record decision-level adopt/reject verdicts against KOTA primitives in src/modules/autonomy/AGENTS.md.
created_at: 2026-04-23T21:05:25.157Z
updated_at: 2026-04-23T21:05:25.157Z
---

## Problem

`data/watchlist.yaml` tracks 22 peer agent runtimes and research surfaces.
The AutoGen snapshot (`github.com/microsoft/autogen`, last seen
2026-04-20) explicitly records that "ongoing investment is shifting to
the successor Microsoft Agent Framework", yet MAF itself has never been
on the watchlist and has no verdict in `src/modules/autonomy/AGENTS.md`
External Pattern Decisions. Every other major-vendor agent runtime
(Anthropic Claude Code, OpenAI Codex, Google Gemini CLI, Block Goose,
Vercel AI SDK) already carries an adopt/reject or "already covered" line;
the Microsoft ecosystem's only entry is the frame its own maintainers
have deprecated.

Explorer added `https://github.com/microsoft/agent-framework` to the
watchlist in the same run that created this task so the snapshot
capture can happen on the next explorer cycle, but the distillation
itself needs its own task — adding the URL does not produce a durable
KOTA position.

## Desired Outcome

`src/modules/autonomy/AGENTS.md` carries a decision-level MAF line in
External Pattern Decisions or the harness-posture section, naming the
specific KOTA primitive it maps onto or displaces (workflow, agent-
harness, module, delegate, composition, bus event, daemon control API,
or store). The watchlist snapshot for
`https://github.com/microsoft/agent-framework` is captured with
fingerprint, summary, and `last_seen_at` via
`<run-directory>/watchlist-updates.json` so future explorer runs can
detect drift. If MAF ships a primitive KOTA's existing protocols cannot
express, a concrete follow-up task lands in `data/tasks/backlog/`
rather than inlining a speculative adoption.

## Constraints

- Read the repo end-to-end (README, architecture docs, example code)
  before writing a verdict. Do not infer content from AutoGen-to-MAF
  migration prose or third-party summaries.
- Keep the verdict one sentence in the existing External Pattern
  Decisions style ("**Pattern name.** Decision. KOTA primitive it
  compares against."). Multi-paragraph exegesis belongs in run
  artifacts, not autonomy's durable contract.
- A verdict must name the concrete KOTA surface it compares against —
  named workflow, agent-harness adapter, module, or bus event. "Already
  covered by X" with no named X is not a verdict.
- Do not retract or narrow a prior External Pattern Decisions entry
  without flagging the specific bullet and the evidence that changed.
- If the repo is inaccessible or the MAF project is unclear which of
  `microsoft/agent-framework` / `microsoft/semantic-kernel` / another
  canonical location is the live successor, move the task to `blocked/`
  with the specific URL and failure mode rather than guessing.
- Do not open a second watchlist entry for MAF; the entry seeded in
  this run is the single source.

## Done When

- MAF has a one-sentence adopt / reject / already-covered verdict in
  `src/modules/autonomy/AGENTS.md` that names a KOTA primitive.
- The watchlist snapshot for
  `https://github.com/microsoft/agent-framework` is populated via
  `<run-directory>/watchlist-updates.json` with fingerprint, summary,
  and `last_seen_at`.
- Any MAF primitive that KOTA's existing protocols cannot express has
  a concrete follow-up task in `data/tasks/backlog/` naming the
  subsystem that would own it.
- If MAF turns out to be inaccessible or canonical-location-ambiguous,
  the task is moved to `blocked/` with the specific URL and failure
  mode recorded.
