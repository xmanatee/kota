---
status: done
---

# Give autonomy evaluator a runtime-probe path for non-artifact outcomes

## Problem

The builder's critic (`src/modules/autonomy/critic.ts`) inspects the
diff, task state, and run artifacts, then grades the work against the
task contract. Anthropic's Mar 2026 "Harness design for long-running
application development" post shows their evaluator agent was given
Playwright MCP so it could interact with the built app as a user would
— catching failures that a diff-only review misses.

KOTA's critic is structurally blind to anything that does not land in
repo state: a UI regression, a daemon runtime misbehavior, an HTTP
route returning the wrong payload, an event bus ordering bug. Today
the autonomy loop sidesteps this by funnelling such tasks toward
outcomes that *do* land as tests or artifacts. That is fine when tasks
are carefully shaped, but it means the generator-evaluator pattern
breaks down when a task's success is genuinely runtime behavior.

## Desired Outcome

- Tasks whose success predicate is runtime behavior can declare a probe
  in the task contract (e.g. a typed command the critic runs, or an
  MCP tool invocation) that produces a verdict the critic uses
  alongside artifact inspection.
- The probe is optional — artifact-only tasks keep working unchanged.
- Probe invocation reuses normal guardrails and autonomy-mode policy;
  no test-only production flag introduces a bypass.
- The module's `AGENTS.md` documents when to add a probe and when to
  reshape the task to be artifact-gradable instead (the cheaper default).

## Constraints

- Module-first: the probe primitive lives in the autonomy module, not
  in core.
- No parallel evaluator agent — the existing critic stays the single
  evaluator entry point; the probe extends its input.
- Probe execution must honor the same autonomy mode and approval queue
  rules as the normal agent loop; it is not a side channel.
- Keep the probe surface small and typed. No per-task DSL for shaping
  probe invocations.

## Done When

- Tasks can declare an optional runtime probe with a typed contract
  and a pass/fail predicate the critic honors.
- At least one autonomy workflow has an end-to-end test of a
  probe-gated task.
- The autonomy module's `AGENTS.md` documents the probe model and
  when to prefer artifact-only success predicates instead.
