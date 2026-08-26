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
- `WorkflowScenarioDriver` delegates validation and every step semantic to the
  production executor. It may adapt typed host ports, but must never interpret
  steps, scheduling, branching, persistence, retries, or recovery itself.
- Testing exports remain narrow and must not become a public alternate runtime.
