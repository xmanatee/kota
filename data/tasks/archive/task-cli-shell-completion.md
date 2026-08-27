---
status: done
---

# Add shell completion for kota CLI commands

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
