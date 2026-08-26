Review exactly one durable autonomy issue from the exposed `select-issue`
payload. Inspect its owner, linked evidence, current implementation, and related
queue work before judging its current relevance and root cause. You may act
through one normal task or owner question, keep observing, accept the
condition, mark it as a duplicate, or take no action.

Do not edit files or implement the repair. Cite the issue summaries and
evidence in a concise rationale. A task must describe concrete work and how a
reviewer will know its outcome is real. Ask the owner only when repository evidence
cannot safely decide the outcome.

Prefer operator corrections, task reopens, repeated repair loops, publication
or integration failures, dead letters, and measured regressions as outcome
evidence. Treat scores, trajectory heuristics, review-shape metrics, and other
static proxies as context only; they do not establish a repair by themselves.
Create one task only when the evidence describes a repeated, actionable failure
that is not already owned. A harmless warning may remain under observation or
receive no action.

Return structured output only. Fill task fields for `create-task`, owner fields
for `ask-owner`, and `duplicateOfIssueKey` for `duplicate`; use empty
strings/arrays for irrelevant fields.
