---
id: task-jira-task-provider
title: Add Jira Cloud task provider module
status: done
priority: p3
area: modules
summary: Teams using Jira Cloud have no way to feed their existing issue tracker into KOTA's builder queue. A Jira module implementing TaskProvider would let the builder pull from Jira issues the same way it does from Linear and GitHub Issues.
created_at: 2026-04-10T05:20:00Z
updated_at: 2026-04-10T05:20:00Z
---

## Problem

KOTA's builder can pull tasks from a `TaskProvider` backend: currently Linear
and GitHub Issues are supported. Teams using Jira Cloud as their primary issue
tracker must either duplicate work into KOTA's local task queue or adapt their
workflow to a supported provider.

The provider interface (`TaskProvider` in `src/provider-types.ts`) is stable and
simple: `list`, `claim`, `complete`, `add`, `archiveCompleted`. Linear and GitHub
show the pattern clearly — an API client wraps Jira's REST API v3 and maps issues
to KOTA task format.

## Desired Outcome

A `jira` module at `src/modules/jira/` that:

- Registers `JiraTaskProvider` when `modules.jira.taskProvider.enabled` is true.
- Authenticates via API token + email (`JIRA_API_TOKEN`, `JIRA_USER_EMAIL`, `JIRA_BASE_URL`).
- Lists issues from a configured project key filtered to the authenticated user (or all unassigned when `claimOnStart: false`).
- Maps Jira issue fields to KOTA task format: `id` (issue key), `title` (summary), `priority` (p0–p3 from Jira priority), `status`, `area` (component label if present), `summary` (description excerpt).
- `claim` transitions an issue to "In Progress" and assigns it to the user.
- `complete` transitions an issue to "Done".
- Uses Jira REST API v3 (`/rest/api/3/`) with basic auth; no npm dependencies.

Config documented in `docs/CONFIG.md` under a `## Jira module` section.

## Constraints

- Follows the same module structure as `src/modules/linear/` and `src/modules/github/`.
- API credentials stored via the secrets/env-var pattern (`$ENV_VAR` references in config).
- Token is never logged.
- Issue list is cached at init; mutations (claim/complete) fire async Jira API calls.
- Jira's transition model requires looking up transition IDs; cache them at init.
- No handling for Jira Data Center (Cloud only; Cloud base URL ends in `.atlassian.net`).

## Done When

- `JiraTaskProvider` implements `TaskProvider` and passes unit tests covering `list`, `claim`, `complete`, and `add`.
- Module loads without error when `modules.jira.taskProvider.enabled` is true.
- `docs/CONFIG.md` has a Jira section with all config fields documented.
- `src/modules/jira/AGENTS.md` describes the module, its files, and boundaries.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` pass.
