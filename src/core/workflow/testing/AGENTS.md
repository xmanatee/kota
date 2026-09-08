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
- `WorkflowScenarioDriver` composes the production validator, executor,
  `RunCoordinator`, and `RunLifecycle`. Integration validation and semantic
  invariants run through their production owners before writer success.
  Child definitions use the production trigger queue and coordinator waits;
  scripted step outputs are only agent/tool port responses.
  Scenario inputs may seed the allocated checkout; they cannot replace it.
- Scenario state is a SQLite location, never an injected state interpreter.
  The lifecycle creates the run context and the coordinator settles its
  outcome. Rejected integration cannot publish staged state or events.
  State fixtures require a caller-owned directory that its teardown removes.
- Context and state fixtures support focused executor or decision tests; they
  do not establish coordinator, repository integration, or restart behavior.
  Those claims require the production runtime host.
- Testing exports remain narrow and must not become a public alternate runtime.
