---
id: task-distill-undistilled-anthropic-engineering-posts-in
title: Distill undistilled Anthropic engineering posts into autonomy decisions
status: done
priority: p2
area: research
summary: Read the Anthropic engineering posts not yet folded into autonomy AGENTS.md (agent brains/hands decoupling, Claude Code auto mode and sandboxing, harness design for long-running app development, multi-Claude parallel builds) and record decision-level takeaways or 'read, no action' rejections.
created_at: 2026-04-23T20:30:03.587Z
updated_at: 2026-04-23T20:39:52.834Z
---

## Problem

`data/watchlist.yaml` has listed `https://www.anthropic.com/engineering`
since 2026-04-19 with a summary flagging five recent Anthropic engineering
posts relevant to KOTA autonomy: quantifying infra noise in coding evals,
decoupling agent brains/hands at scale, Claude Code auto mode and sandboxing,
harness design for long-running app development, and multi-Claude parallel
C-compiler builds. Only the infra-noise post has been folded into decisions
(`Infrastructure Noise Rule` in `src/modules/eval-harness/AGENTS.md` and
`Infrastructure noise is not statistical noise` in
`src/modules/autonomy/AGENTS.md`). The other four posts have never been
distilled into adopt/reject entries under autonomy's External Pattern
Decisions, so their signal either gets re-read ad hoc each time someone
references that index, or quietly leaks through without a durable KOTA
position.

Recent pattern (`task-distill-new-claude-blog-posts-into-autonomy-decisi`,
`task-distill-never-distilled-watchlist-researchblog-sur`) is one targeted
distillation task per source, producing either a concrete AGENTS.md entry or
an explicit 'read, no action' verdict plus a watchlist snapshot refresh.
This task covers the Anthropic engineering surface that the earlier sweeps
never reached.

## Desired Outcome

Each of the four undistilled posts gets an explicit, single-sentence
verdict in `src/modules/autonomy/AGENTS.md` under External Pattern
Decisions (or the harness-posture section, whichever is load-bearing),
either adopting a concrete rule or recording 'read, no action' with the
reason. The Anthropic engineering watchlist snapshot is refreshed via
`<run-directory>/watchlist-updates.json` so the `last_seen_at` advances and
the summary names the four posts by title. Any adopted rule flows to the
narrowest load-bearing AGENTS.md (e.g. a sandboxing rule belongs in
`src/core/tools/AGENTS.md` if it is actually about tool guardrails rather
than autonomy posture).

## Constraints

- Read each post end-to-end before writing a verdict. Do not infer content
  from the watchlist summary or post titles — the summary exists to point
  attention, not to substitute for reading.
- If a post is auth-walled or fails to fetch, move the task to `blocked/`
  with the specific URL and the failure mode, rather than recording a
  verdict based on a partial read.
- Do not adopt a rule that contradicts an existing autonomy decision
  without explicitly retracting or narrowing the prior entry in the same
  commit. The External Pattern Decisions list must stay internally
  consistent.
- Keep verdicts one sentence each. Multi-paragraph exegesis belongs in the
  post, not in autonomy's durable contract.
- Do not expand `anthropic.com/engineering` into four separate watchlist
  entries. One watchlist entry per source is the existing convention.

## Done When

- Each of the four posts (brains/hands decoupling, Claude Code auto mode
  and sandboxing, long-running app harness design, multi-Claude parallel
  builds) has a one-sentence adopt-or-reject verdict in
  `src/modules/autonomy/AGENTS.md` or the narrowest appropriate AGENTS.md.
- Any adopted rule has a concrete place it applies (named module, named
  workflow, named guardrail) rather than a general aspiration.
- The watchlist snapshot for `https://www.anthropic.com/engineering` is
  refreshed with a summary that names the four distilled posts.
- If a post is inaccessible, the task is moved to `blocked/` with the
  specific URL and failure mode recorded in the body.
