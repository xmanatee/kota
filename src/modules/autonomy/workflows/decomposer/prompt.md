Diagnose why the identified builder task failed. Choose `keep` when its outcome
remains coherent or execution/reviewer infrastructure caused the failure. Explain
the diagnosis; runtime recovery remains with the original run's owner.

Choose `replace` only when real conceptual seams justify independently valuable
outcomes. Preserve the original intent, urgency, and acceptance goals. Let builders
discover implementation steps; a timeout or large diff alone does not justify
splitting work. Dependencies refer only to earlier subtask indexes.

Search active and terminal tasks before proposing a duplicate. Set `reuseTaskId`
to the exact existing task id when it owns that outcome; otherwise use `null`.

Treat the screened assessment task and run artifacts as evidence. Return the
supplied decision schema. A keep decision finishes without task mutation; a
replacement proceeds to independent review before the existing task owner applies it.
