---
status: done
---

# Record architecture decision for worktree-backed autonomy

## Problem

KOTA has local constraints that generic "use git worktrees" advice does not
answer. The builder currently edits `projectDir` directly, workflow agent steps
derive cwd from `agentConfig.projectDir`, dirty recovery assumes one checkout,
and `src/modules/autonomy/workflows/builder/AGENTS.md` explicitly forbids
worktrees. KOTA needs an architecture decision before implementation so this
does not become scattered prompt text and ad hoc git commands.

## Desired Outcome

KOTA has a concise architecture decision that defines:

- canonical project path vs mutable workspace path;
- which module owns git worktree lifecycle primitives;
- how workflow steps receive `workspaceDir`;
- how task claims prevent duplicate parallel builders;
- how merge, conflict resolution, validation, and cleanup are ordered;
- when automated conflict resolution is allowed to proceed;
- when unresolved work must remain as a pending merge instead of being hidden;
- how the decision revisits the existing "Multi-Claude parallel builds" reject
  note in `src/modules/autonomy/external-pattern-decisions.ts`.

## Constraints

- Ground the decision in external systems and measurements, but keep the local
  design compatible with KOTA's existing module-first architecture.
- Do not create a broad external-link catalog. Keep only the links required to
  justify this decision.
- Preserve the single workflow engine boundary from `docs/ARCHITECTURE.md`.
- Explicitly call out what worktrees do not isolate: ports, dependencies,
  local databases, generated artifacts, and semantic conflicts.

## Done When

- The decision names the intended runtime shape:
  claim task, create and lock worktree, prepare environment, run agent,
  validate, commit, rebase or merge through gate, resolve bounded conflicts,
  rerun validation, update task/run state, then cleanup.
- The decision lists non-negotiable safety rules for dirty canonical checkouts,
  unresolved conflicts, untracked work, binary conflicts, and failed validation.
- The decision records rollout order: builder, status/cleanup, other mutating
  autonomy workflows, then guarded parallelism.
- `external-pattern-decisions.ts` is updated or superseded so the prior
  parallel-build rejection has an explicit revisit path.

## Source / Intent

Research inputs:

- Claude Code worktrees isolate agents in separate working directories and
  branches, lock active worktrees, and only clean up worktrees that have no
  uncommitted, untracked, or unpushed work:
  https://code.claude.com/docs/en/worktrees
- Claude Code agent teams coordinate parallel teammates, but Anthropic warns
  they use significantly more tokens and are best for independent work:
  https://code.claude.com/docs/en/agent-teams
- Codex app worktrees and background automations run in dedicated worktrees,
  use managed detached worktrees, and use `.worktreeinclude` for ignored local
  setup files:
  https://developers.openai.com/codex/app/worktrees
- GitHub Copilot cloud agent runs in its own ephemeral GitHub Actions-powered
  environment, creates branches/PRs, and can resolve merge conflicts:
  https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Jules clones into a VM, plans before editing, works from a selected branch,
  and supports concurrent tasks:
  https://jules.google/docs/
- Devin MultiDevin uses a main session with isolated worker sessions and merges
  successful workers back into one branch or PR:
  https://docs.devin.ai/release-notes
- AgenticFlict reports 29,609 merge-conflicting PRs out of 107,026 processed
  agentic PRs, a 27.67% conflict rate:
  https://arxiv.org/html/2604.03551v2
- "Where Do AI Coding Agents Fail?" reports 33,596 agentic PRs with 71.48%
  merged overall, with larger/churnier PRs less likely to merge:
  https://arxiv.org/html/2601.15195v1
- SWE-bench Verified describes the issue-plus-repo-plus-tests evaluation loop:
  https://openai.com/index/introducing-swe-bench-verified/
- SWE-bench Pro reports low Pass@1 on enterprise-grade tasks, reinforcing the
  need for validation gates rather than trusting generated patches:
  https://arxiv.org/html/2509.16941v1
- Practitioner reports emphasize that worktrees solve file isolation but not
  preview environments, ports, databases, dependency setup, or semantic
  collisions:
  https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents
  https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- The decision file or code decision entry cites the local files it changes or
  constrains, including builder workflow, branch-per-task, workflow agent run
  options, dirty recovery, and scheduler concurrency.
- `pnpm test` passes for any updated decision tests or decision-coverage
  checks.
- The follow-on task graph remains consistent with the decision.
