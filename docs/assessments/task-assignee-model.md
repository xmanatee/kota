# Assessment: Task Assignee Model for Multi-Agent Routing

**Status:** Reject assignees. Keep implicit work separate. Defer runtime task objects.

## Current State

Nine autonomy workflows, six backed by named agents:

| Workflow | Agent | Trigger | Work Source |
|----------|-------|---------|-------------|
| dispatcher | (code-only) | `runtime.idle` | queue state assessment |
| builder | builder | `autonomy.queue.available` | `data/tasks/{doing,ready,backlog}/` |
| explorer | explorer | `autonomy.queue.{empty,thin}` | codebase + external ideas |
| inbox-sorter | inbox-sorter | `autonomy.inbox.available` | `data/inbox/` |
| improver | improver | `workflow.build.committed`, failures, recovery | run outcome data |
| decomposer | decomposer | `workflow.completed` (builder failed) | failed run metadata |
| pr-reviewer | pr-reviewer | `github.pull_request` | GitHub webhook payload |
| knowledge-capture | (code-only) | `workflow.completed` (builder/improver success) | run artifacts |
| attention-digest | (code-only) | various alert events | run/cost/failure data |

Work routing is event-driven. The dispatcher assesses queue state on idle and
emits semantic condition events. Each workflow subscribes to exactly the events
matching its role. Workflows with agent steps also run a code inspection step
before the agent that gates execution on current conditions.

Only the builder consumes repo tasks from `data/tasks/`. Every other workflow
has its own work discovery mechanism with a fundamentally different input shape.

## Question 1: Should tasks have assignees?

**Recommendation: No.**

Adding an assignee field to repo tasks would create a routing mechanism that
competes with the existing event-driven dispatch. The dispatcher already
evaluates queue state and emits targeted events. Workflows already gate their
agent steps on assessed conditions. An assignee field would add a second routing
path that must stay synchronized with the first.

The scenario where assignees seem useful is routing research-oriented tasks to
the explorer instead of the builder. But this conflates two distinct operations:
the explorer generates work by studying the codebase and external ideas; the
builder executes normalized tasks. Having the explorer execute tasks pulled from
a queue would change its role from "discover what should exist next" to
"research a specific question on demand." That is a different capability, and if
it is needed, it should be a new workflow with its own trigger, not a routing
annotation on existing task files.

The `area` field already carries domain context (architecture, runtime, stores,
clients) for grouping and reporting. Adding `assignee` would serve a different
purpose (routing) and would need to be kept in sync with workflow trigger
subscriptions, creating two sources of truth for "who handles this."

**If routing needs grow:** Enrich the dispatcher's assessment to emit
more specific events (e.g., `autonomy.research.needed`) and add a new workflow
that subscribes. This extends the existing model rather than adding a parallel one.

## Question 2: Should implicit work be unified under the task model?

**Recommendation: No.**

Inbox items, improvement opportunities, exploration triggers, and PR review
requests have fundamentally different lifecycles:

- **Inbox items** are unstructured captures with no required schema. Their
  processing is normalization: turning rough notes into tasks, docs, or drops.
- **Improvement opportunities** are evidence-driven: run outcome data, failure
  patterns, cost trends. The improver does not pick from a queue; it responds to
  system signals.
- **Exploration triggers** are condition-driven: the queue is empty or thin, and
  a cooldown has elapsed. The explorer does not consume a work item; it assesses
  what should exist.
- **PR reviews** are webhook-driven with a payload specific to GitHub.

Forcing these into the task schema (`id`, `title`, `status`, `priority`, `area`,
`summary`, `created_at`, `updated_at` + body sections) would require either
making most fields optional (violating strict-by-default) or maintaining
multiple task subtypes (adding schema complexity without routing benefit).

The current model where each workflow owns its work discovery is cleaner: the
workflow definition is the complete specification of what triggers it, what it
inspects, and what it produces. No external routing table or assignee resolution
is needed.

## Question 3: Should tasks become first-class runtime objects?

**Recommendation: Defer.**

File-based tasks under `data/tasks/` are git-tracked, diffable, agent-readable,
and CLI-manageable. The `kota task` CLI handles state transitions atomically
with `git mv` and frontmatter updates. This model has produced 550+ completed
tasks without structural problems.

Runtime task objects (backed by an in-memory or database store) would be
appropriate when:

- Multiple daemons need to share a task queue (multi-project support).
- Task state transitions need sub-second latency (interactive task management).
- External task providers (GitHub issues, Jira, Linear) need to be unified with
  repo tasks in a single queryable interface.

None of these conditions exist today. The external task provider interfaces
(`TaskProvider` for GitHub, Jira, Linear) already exist as module-owned
integrations and serve a different purpose (syncing external project management
tools), not routing autonomous workflow execution.

When external project support arrives (the "enable KOTA to operate on external
projects" task), the task model will need revisiting. At that point, the
question becomes whether each external project carries its own `data/tasks/`
or whether a shared runtime store federates across project roots. That design
should be driven by the external-project task, not preemptively added now.

## Summary

| Question | Recommendation | Rationale |
|----------|---------------|-----------|
| Task assignees | Reject | Event-driven routing already works; assignees would be a competing mechanism |
| Unify implicit work | Reject | Work sources are heterogeneous; forced unification adds schema complexity |
| Runtime task objects | Defer | File-based model works at current scale; revisit with multi-project support |

The existing architecture — dispatcher emits semantic events, workflows
subscribe and self-gate — is the correct routing model. It scales by adding
new events and new workflows, not by adding routing metadata to task files.
