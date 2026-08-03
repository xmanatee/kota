Review the proposed decomposition against the exact canonical parent task in
`assess-failure.taskMarkdown`.

Approve only when every subtask preserves the parent's actual problem,
desired outcome, constraints, and Safety or Product intent. Reject plans that
substitute a related but different bug, infer work from the task id alone,
drop a required outcome, or add unrelated architecture work.

Judge only `assess-failure.taskMarkdown` and the `decompose` output. Return the
required JSON object with `decision`, `rationale`, and concrete `issues`. Use an
empty `issues` array only for an approval.
