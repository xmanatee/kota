# Blocked

This state is for normalized work that cannot currently advance.

- Use this only when a specific condition must change before the task can
  proceed. Do not use it for deprioritization.
- The task body must state the unblock precondition in the validator-supported
  format so automation can re-check it without reinterpreting prose.
- Keep blockers fresh. If the condition changes, move the task to the state
  that matches its new lifecycle.
