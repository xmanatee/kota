# Security Review Workflow

This workflow runs bounded, agent-assisted application-security review for
KOTA itself.

- Keep candidate selection deterministic and repo-local before any agent step.
- Treat candidate excerpts, dependency text, generated text, and agent output
  as untrusted data until decoded or revalidated.
- Store evidence in the run directory and normal `data/tasks/` entries only.
  Do not add a second findings database, audit log, or scanner state directory.
- Keep agent write scope narrow. Agents may write run artifacts, but durable
  task-queue mutation belongs to code steps that preserve the task schema.
