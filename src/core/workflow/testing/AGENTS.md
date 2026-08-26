# Workflow Testing

Workflow behavior is owned by the production run host and step executors.

- Exercise definitions through the production host with a temporary scope and
  controlled external ports. Assert admission, durable outputs, effects, and
  lifecycle results rather than a second interpreter's internal steps.
- Pure predicates and value transformations may be tested directly as ordinary
  functions when they contain a distinct decision.
- Agent/model calls, clocks, credentials, and outbound processes may be faked
  at their typed ports. Scheduling, branching, retries, persistence, and
  recovery are not fake ports.
- `WorkflowTestHarness` is legacy migration surface. Do not add step types,
  semantics, or new consumers to it. Move scenarios to the production host and
  remove the corresponding harness behavior as coverage migrates.
- Testing exports remain narrow and must not become a public alternate runtime.
