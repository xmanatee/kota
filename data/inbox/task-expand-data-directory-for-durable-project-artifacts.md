---
title: Evaluate whether data should contain durable artifacts beyond tasks
created_at: 2026-05-07T12:27:35.000Z
source: owner
---

Owner question:

Should `data/` contain more than tasks? `.kota/` is appropriate for runtime
logs, session state, and disposable run artifacts, but some project-internal
knowledge may be durable and valuable without being a task or code/doc change.

Candidate durable data:

- Research artifacts from a researcher agent.
- Article/source summaries and dispositions.
- Analysis reports over logs, commits, queue movement, or quality metrics.
- Project-management notes that are not themselves tasks.
- Architecture investigation artifacts linked from tasks.

Risks to consider:

- Do not create a blog or notes junk drawer.
- Do not duplicate the same content across tasks, research files, docs, and run
  artifacts.
- Do not weaken `data/tasks/` as the source of truth for actionable work.
- Do not move disposable runtime data out of `.kota/`.

Possible shape:

- Tasks can link to durable research/artifact records.
- Artifact records link back to the task or source that produced them.
- Frontmatter could define type, source, owner/agent, created_at, related task
  ids, and disposition.
- Validation should catch orphaned artifacts, duplicated summaries, and
  references to missing tasks/sources.

Research question:

Are tasks expressive enough today, or is the repo constrained by treating all
valuable non-code/non-doc data as either task prose or `.kota/` runtime output?

Initial research notes:

- `data/` already contains more than normalized tasks: `data/inbox/` and
  `data/watchlist.yaml` are durable project data. `data/AGENTS.md` deliberately
  separates rough captures, normalized work, and external-resource monitoring.
- Current standards say Git history and `.kota/runs/` are the historical
  record, runtime state belongs under `.kota/`, and KOTA should not add
  parallel changelog/audit/archive/lesson surfaces.
- Knowledge and memory modules currently store runtime/domain records under
  `.kota/data` or scoped module storage rather than tracked `data/`.
- The existing autonomy report reads existing surfaces (`data/tasks/`,
  `.kota/runs/`, run summaries) for operator analysis instead of creating a
  new durable report corpus consumed by agents.
- External primary docs reinforce the need to separate durable state from
  orchestration artifacts:
  - Temporal treats workflow event history as the source of truth for execution
    replay and keeps side-effect results in history:
    https://docs.temporal.io/workflows
  - LangGraph persistence/checkpoints support resume and human-in-the-loop, but
    durable execution is not the same as a hand-maintained knowledge notebook:
    https://docs.langchain.com/oss/python/langgraph/durable-execution
  - CrewAI Flows expose state and memory, but still distinguish flow state from
    task/crew configuration:
    https://docs.crewai.com/en/concepts/flows

Current assessment:

Do not create a generic `data/artifacts/` or notes drawer. A durable artifact
surface may be useful only if it is typed, sparse, validated, and linked from a
task or source. The best candidate is a narrow research/source-disposition
surface, not a general project journal.

Possible narrow shape to research:

- `data/research/` or `data/sources/` with frontmatter: `id`, `type`, `source`,
  `status`, `created_at`, `related_task`, `producer`, and `disposition`.
- Task bodies link to research records when they need durable evidence.
- Validator flags orphaned records, missing source URLs, unknown related tasks,
  and duplicate records for the same source.
- Runtime outputs and run-level evidence remain in `.kota/runs/`; repeated
  durable lessons still graduate to scoped `AGENTS.md`, not this surface.

Revisit condition:

Add a durable artifact directory only if researcher/explorer/inbox-sorter runs
show repeated loss or duplication of valuable source dispositions that cannot
fit cleanly in tasks, watchlist entries, scoped docs, or run artifacts.
