---
id: task-run-repo-local-ai-check-files-through-the-workflow
title: Run repo-local AI check files through the workflow system
status: done
priority: p2
area: modules
summary: Discover repository-local AI check files and execute them as workflow-backed PR review checks instead of maintaining a parallel review/check runner.
created_at: 2026-05-26T22:11:11.951Z
updated_at: 2026-05-26T23:31:02Z
---

## Problem

KOTA has first-class workflows, agents, GitHub webhook routing, guardrails, and
advisory PR review. It does not yet have a way for a project to declare several
durable, repo-local AI review checks without adding another workflow file per
standard or teaching operators to duplicate those checks in prose prompts.

Continue has moved its public surface toward source-controlled AI checks:
markdown files under `.continue/checks/` or `.agents/checks/` that run as
focused PR review agents. The useful KOTA signal is not Continue's hosted
control plane or a new check-runner DSL. It is the repo-local contract:
project standards should be concrete files, each check should run through the
existing agent/workflow machinery, and results should be artifact-backed rather
than only a generic review comment.

Without this, KOTA can keep adding one-off review prompts, but cannot import a
small set of project standards into the daemon's workflow model in a way that
is discoverable, replayable, and safe against untrusted PR edits.

## Desired Outcome

Repo-local AI check files can be discovered and executed through KOTA's
existing workflow system:

- KOTA recognizes `.continue/checks/*.md` and `.agents/checks/*.md` at a
  project root as an external check-file format.
- Valid check files become typed, module-owned check definitions that a
  workflow can execute on GitHub pull-request events.
- Each check runs as a focused passive agent step with a strict output schema
  such as `pass | fail | skip`, a short rationale, and optional suggested fix
  text.
- The workflow records per-check artifacts and emits typed events/results so
  operators can inspect exactly which project standard passed or failed.
- When the GitHub module is configured and policy allows it, the workflow posts
  one bounded advisory PR comment summarizing failed checks through the existing
  deterministic `github_comment` step pattern.

## Constraints

- Use the existing module, workflow, agent, guardrails, GitHub webhook, and run
  artifact primitives. Do not add a second check runner, review registry,
  approval path, GitHub client, or durable status store.
- Treat `.continue/checks/` and `.agents/checks/` as an external import format
  normalized at the project boundary. The internal runtime contract should be
  typed KOTA data, not ad hoc markdown parsing spread through the workflow.
- Preserve KOTA's single-way architecture: checks execute as workflows or
  workflow steps, not as a parallel automation engine.
- Discover only root-level markdown files in those two directories. If both
  locations define the same check name, use a deterministic precedence and
  report it in diagnostics.
- Fail loudly on malformed check frontmatter or empty bodies at discovery time;
  do not silently skip invalid policy files.
- For PR-triggered execution, do not let an unreviewed PR modify the policy
  that judges itself. Discover check definitions from the trusted base project
  state when possible; if that base-state read is unavailable, skip with an
  explicit artifact rather than running head-supplied check instructions as
  policy.
- Keep check output advisory. Do not introduce auto-merge, required GitHub
  status checks, or a hosted Continue-compatible control plane in this slice.
- Check prompts are policy text, not durable architecture docs. Do not copy
  their content into `docs/` or global prompts.

## Done When

- A module-owned discovery path loads repo-local check files from
  `.continue/checks/` and `.agents/checks/`, validates required frontmatter
  (`name`, `description`) plus a non-empty body, and exposes typed check
  definitions with provenance.
- The discovery path has focused tests covering valid checks, malformed
  frontmatter, empty bodies, duplicate-name precedence, ignored nested files,
  and deterministic diagnostics.
- A workflow path executes discovered checks on eligible `github.pull_request`
  events using existing workflow/agent-step primitives, actor-integrity gates,
  passive autonomy posture, strict structured output, and bounded runtime.
- The workflow records per-check run artifacts with the check provenance,
  verdict, rationale, and suggested fix text when present.
- The workflow emits a typed event or step output summarizing pass/fail/skip
  counts without requiring clients to parse an agent message.
- If any check fails and `github_comment` is available under policy, the
  workflow posts one bounded advisory comment using the same deterministic
  prepare/approve/post shape as `pr-reviewer`; if posting is unavailable, the
  run still completes with inspectable artifacts.
- Tests or an eval-harness fixture prove a PR-head edit cannot replace the
  trusted check definition that judges that same PR.
- `pnpm kota workflow validate`, `pnpm run validate-tasks`, and the focused
  module/workflow tests pass.

## Source / Intent

Explorer run `2026-05-26T22-08-37-327Z-explorer-04vocl` reviewed an empty
actionable queue. The strategic blocked alternatives were all real
operator-capture waits and not movable, so opening one workflow/module slice is
preferable to declaring no-op or creating client fan-out work.

External sources checked:

- `https://github.com/continuedev/continue` now describes Continue as
  "source-controlled AI checks" where markdown check files in the repository
  run on pull requests.
- `https://docs.continue.dev/checks/reference` documents
  `.continue/checks/` and `.agents/checks/` as check-file locations with
  required `name` and `description` frontmatter.
- `https://docs.continue.dev/cli/tool-permissions` shows the matching
  headless-agent posture: read-only review/status tools are allowed by default,
  while write/execute tools require explicit policy.

KOTA already has PR review, security review, guardrails, skills, and workflow
artifacts. The nonduplicative local gap is importing repo-local project
standards into the existing workflow model without creating a separate review
engine or trusting unreviewed PR-head policy edits.

## Initiative

Workflow-backed project standards: reusable review policy should live in
discoverable project files while KOTA keeps one workflow execution model,
typed results, and auditable run artifacts.

## Acceptance Evidence

- Diff showing the module-owned check discovery path, workflow execution path,
  typed events/results, and focused tests.
- Transcript under `.kota/runs/<run-id>/` for the focused tests covering
  discovery, malformed files, duplicate precedence, and PR-head policy
  isolation.
- Transcript under `.kota/runs/<run-id>/` for `pnpm kota workflow validate`
  and `pnpm run validate-tasks`.
- Run artifact or eval-harness fixture output showing at least two repo-local
  checks executed on a representative pull-request payload, with one pass and
  one fail represented in structured artifacts and summary output.
- If GitHub posting is exercised, a fake or recorded `github_comment` artifact
  showing one bounded advisory comment body that summarizes failed checks
  without the agent posting directly.
