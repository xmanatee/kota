---
title: Make tasks assignable across agent roles
created_at: 2026-05-07T12:27:35.000Z
source: owner
---

Owner question:

Tasks currently feel mostly builder-executed, but not all tasks are
implementation tasks. Research whether tasks should be assignable to different
agent roles and flow naturally between them.

Possible model:

- Project manager sees a large or unclear task and assigns it to Researcher.
- Researcher gathers sources/artifacts, then returns it to PM or Product.
- Product/Product Owner decides what matters and may assign to Architect.
- Architect plans how it fits the current architecture and creates/splits
  implementation work.
- Builder implements concrete work.
- Verifier/Critic checks outcome and may send it back to Builder.

Questions:

- Should assignment be frontmatter, task state, event metadata, or a separate
  queue/routing artifact?
- Should one task have one current owner role, or multiple requested roles?
- What permissions does each role have: create tasks, move tasks, drop tasks,
  edit specs, write code, run checks?
- How do we prevent excessive handoff bureaucracy?
- How do we keep agents broadly capable while still giving each role a default
  scope?
- How should blocked/ready/backlog semantics change if tasks can be assigned?

Goal:

Make task flow match real work types without over-constraining agents or
turning the queue into process theater.

Initial research notes:

- The normalized task schema currently centers `id`, `title`, `status`,
  `priority`, `area`, `summary`, timestamps, and body sections. There is no
  active `assignee`, `owner_role`, or `assigned_to` field in the task schema or
  queue validator.
- Prior completed work already asked this question:
  `data/tasks/done/task-assess-task-assignee-model-for-multi-agent-routing.md`.
  Any new work must start by recovering that decision/outcome, not by adding a
  second assignment model from scratch.
- Workflow/event routing already provides implicit role routing: dispatcher
  emits queue-shape events, builder gates on `autonomy.queue.available`,
  backlog-promoter promotes backlog, blocked-promoter handles typed blockers,
  explorer handles empty/thin queue, decomposer reacts to failed large work,
  and inbox-sorter owns inbox captures.
- External primary docs show two relevant patterns:
  - OpenAI Agents SDK handoffs represent specialist transfer as tool-like
    routing with optional structured input:
    https://openai.github.io/openai-agents-python/handoffs/
  - AutoGen Core type subscriptions map topic types to agent types, so routing
    is event/topic shaped rather than task-frontmatter shaped:
    https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/core-concepts/topic-and-subscription.html

Current assessment:

Do not add a generic assignee field without a small routing design first. The
safer question is whether KOTA needs typed `required_role` / `next_role`
metadata for exceptional tasks that cannot be handled by current workflow
events. If adopted, it should integrate with queue validation and existing
workflow triggers rather than replacing `ready/backlog/blocked`.

Possible narrow shape to research:

- `required_role`: a controlled vocabulary, optional, used only when normal
  area/priority/state routing is insufficient.
- Role workflow validates it recognizes the value before claiming.
- Handoffs append a short artifact/result and either clear or replace the role.
- Validator flags unknown roles and tasks stuck too long with a role that no
  workflow can consume.

Revisit condition:

Adopt assignment only if repeated evidence shows tasks are blocked, misrouted,
or over-scoped because the queue cannot express a non-builder next action.
