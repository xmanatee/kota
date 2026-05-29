# Trajectory Diagnostic Escalator

This workflow turns recurring workflow agent-step trajectory-diagnostic
warnings into normalized repair tasks.

- Read only `steps/<step-id>.trajectory-diagnostics.json` artifacts and run
  metadata when detecting patterns.
- Keep grouping deterministic: workflow, step id, typed warning code, and a
  bounded detail fingerprint.
- Do not scrape raw event streams, prompts, secrets, full tool outputs, or
  operator-only report ranking.
- Keep terminal workflow failures owned by `workflow-failure-escalator`.
