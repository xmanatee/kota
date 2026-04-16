# Improver trigger logic feels overwrought

Improver listens to three separate events (`workflow.build.committed`, `workflow.completed` for monitored failures, `runtime.recovered`) each with a 60m cooldown. But its input step (`gather-run-data`) reads aggregate stats across all recent runs — it doesn't actually care which run triggered it or whether that run succeeded.

- ideally it runs every few runs ...
- ideally it should be agnostic of entities it improves.. it shouldn't be locked on builder or any other specific agent or workflow... it should "run every now and then, look at all the logs and signals and failures and gaps e.t.c. and try to improve everything: prompts, agents, setups e.t.c."
- Is the distinction between `workflow.build.committed` (builder-only, success-only) and `workflow.completed` (all workflows, all statuses) still pulling its weight, or is it historical baggage?
- Confirm whether the 60m cooldown is still appropriate under a simpler trigger.
