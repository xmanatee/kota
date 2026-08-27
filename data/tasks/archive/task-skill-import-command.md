---
status: done
---

# Add skill import command to install external skills from URLs or local paths

## Problem

KOTA supports SkillDef contributions from modules and local `.kota/skills/` files, but there is no operator-facing command to install a skill from an external URL. Operators who want community skills must manually download markdown files and place them in the right directory. The skills.sh ecosystem publishes skills in a compatible markdown-with-frontmatter format that could be directly imported.

## Desired Outcome

`kota skill import <url-or-path>` command that:
- Accepts GitHub raw URLs or local file paths
- Downloads the skill markdown, validates it contains a recognizable SkillDef frontmatter block, and writes it to `.kota/skills/<name>.md`
- Supports `--name <override>` to rename on install
- Reports the skill name and destination after successful install

## Constraints

- No new runtime dependencies beyond Node built-in fetch
- Does not auto-activate skills; only installs to `.kota/skills/`
- Validates that the file has at minimum a `name` field before writing
- Follows existing `skills-cli.ts` pattern for CLI command registration

## Done When

- `kota skill import <url>` downloads and installs a valid skill markdown file
- `kota skill import <local-path>` copies a local skill file to `.kota/skills/`
- `kota skill list` shows the newly imported skill
- An invalid or unreachable source is rejected with a clear error message
