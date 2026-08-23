---
id: task-make-builder-continuation-evidence-driven-and-prio
title: Make builder continuation evidence driven and priority aware
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Replace unlimited changing repair loops with an evidence-backed continuation decision that preserves productive work, yields safely when higher-priority work appears, and never relies on a blind timeout or cost cap.
created_at: 2026-08-16T08:35:37.163Z
updated_at: 2026-08-16T08:36:30.000Z
---

## Problem

During the 61-hour Codex-backed run from 2026-08-13 through 2026-08-15,
builders occupied the only agent slot for about 57 hours and recorded roughly
994 million input tokens. Three individually useful builders lasted about 9.0,
9.6, and 6.5 hours. One P1 run remained active after a P0 runtime defect had
been proven, because an active builder has no way to checkpoint and yield.

This is not a timeout defect. `agent-policy.test.ts` intentionally requires
unbounded builder turns and repair attempts, while `repair-loop.ts` stops only
after three identical no-progress states. A sequence of changing failures,
diffs, or verification commands can therefore continue indefinitely even when
the remaining work should be decomposed, preserved for later, or temporarily
yielded to more urgent work. The current signals prove activity, but no owner
decides whether another iteration remains the best use of the single agent
slot.

## Desired Outcome

Give long or expanding builder work one evidence-based continuation decision.
Normal productive runs remain uninterrupted. When accumulated run evidence
shows repeated repair, material scope expansion, unresolved acceptance
criteria, or newly available higher-priority work, a capable agent receives a
compact packet of the task contract, current diff, verification trajectory,
remaining failures, and queue priorities. It decides to continue, decompose,
preserve and yield, or escalate a genuinely ambiguous decision.

A yield is a first-class resumable transition: the current worktree, claim,
agent evidence, and exact next action remain durable, the agent slot becomes
available, and later continuation resumes the same lineage rather than
starting duplicate work.

## Constraints

- Do not add a hard elapsed-time, token, cost, turn, or repair-attempt cap.
- Do not invoke another reviewer after every repair iteration or on a fixed
  cadence. Reuse the repair trajectory and queue revision already available,
  and request judgment only when that evidence creates a new decision.
- Keep one continuation authority in the builder lifecycle. Do not add a
  watchdog, parallel scheduler state, or a second recovery queue.
- Never discard uncommitted work or release its claim before durable preserved
  evidence exists. A failed checkpoint must leave the builder owning its work.
- P0 Safety or runtime work may justify a yield, but priority alone must not
  abort a healthy nearly-complete run. The decision must cite concrete progress
  and remaining-risk evidence.
- Task decomposition must retain the original product intent, dependencies,
  and acceptance evidence and must deduplicate against existing tasks.

## Done When

- Builder run metadata exposes one concise continuation packet and a typed
  decision: `continue`, `decompose`, `preserve-yield`, or `needs-owner`.
- A normal builder with fresh verification progress completes without an extra
  AI call or lifecycle transition.
- Replays of the 9.0-hour, 9.6-hour, and 6.5-hour historical trajectories reach
  an inspectable decision at the first genuinely new continuation boundary;
  repeated unchanged evidence is a no-op.
- A fixture proves that preserved-yield frees the agent slot for newly proven
  P0 work and later resumes the same task, worktree, claim, diff, and evidence
  lineage without duplicate commits or tasks.
- A changing-but-unproductive repair trajectory can be decomposed or preserved
  instead of running forever, while a changing-and-converging trajectory is
  allowed to continue.
- Status and run artifacts explain why the builder continued or yielded and
  distinguish that state from failure, interruption, and pending merge.

## Source / Intent

Owner-requested productivity audit on 2026-08-16. The owner wants capable
agents trusted to finish difficult work, but not for the single agent slot to
be monopolized by mechanically changing repair iterations. The target is a
better decision with existing evidence, not a stricter resource limit.

## Initiative

Evidence-driven productive autonomy.

## Product / Safety Link

This Meta repair returns the only agent slot to higher-priority Product and
Safety work when a large builder should be preserved or decomposed, while
protecting valuable in-progress implementation from forced termination.

## Acceptance Evidence

- A latest-200-run replay comparing builder agent-hours, repair iterations,
  yielded/resumed runs, task outcomes, and duplicate work before and after.
- Focused lifecycle artifacts for normal completion, converging continuation,
  preserve-yield-resume, decomposition, and checkpoint failure.
