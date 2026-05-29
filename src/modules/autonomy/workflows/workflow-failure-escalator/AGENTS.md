# Workflow Failure Escalator

Code-only monitor that turns persistent, non-infrastructure workflow failures
into one evidence-backed repair task per stable pattern.

- Keep threshold detection deterministic and LLM-free.
- Read evidence from `.kota/runs/`; do not add a second workflow-health store.
- Use the shared task-escalation helper in `src/modules/autonomy/` for task
  creation, refresh, and idempotence.
- Operator visibility goes through `workflow.attention.digest` without cost or
  throughput fields.
