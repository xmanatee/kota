---
id: task-cli-shell-completion
title: Add shell completion for kota CLI commands
status: ready
priority: p3
area: cli
summary: The kota CLI has grown to cover workflows, tasks, approvals, and more. Adding zsh/bash completion would speed up daily operator use — completing subcommands, workflow names, run IDs, and flag names without memorizing them.
created_at: 2026-03-27T05:52:33Z
updated_at: 2026-04-02T11:49:09Z
---

## Problem

`kota` has many subcommands and flags (`workflow run`, `workflow list --status`, `task move`, `approval approve`, etc.). Operators must remember exact names and flags. There is no shell completion support.

## Desired Outcome

Running `kota <TAB>` or `kota workflow <TAB>` completes subcommands and flags in zsh and bash. Dynamic completions (e.g., workflow names from the manifest, run IDs from history) are supported where practical.

## Constraints

- Use the completion mechanism already provided by the CLI framework in use (check what commander/yargs/etc. offers before writing custom logic)
- Static completions for subcommands and flags are the minimum bar; dynamic completions are a bonus
- Completion scripts should be installable via a single command (e.g., `kota completion zsh >> ~/.zshrc`)

## Done When

- `kota <TAB>` completes top-level subcommands
- `kota workflow <TAB>` completes workflow subcommands
- `kota workflow list <TAB>` completes known flags (e.g., `--status`, `--workflow`)
- A `kota completion [shell]` command prints the completion script
