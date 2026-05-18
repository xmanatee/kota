---
id: task-preserve-imported-skill-resources-as-directories
title: Preserve imported skill resources as directories
status: done
priority: p2
area: modules
summary: Change imported skill storage and resolution from flattened markdown files to auditable skill directories that preserve SKILL.md plus bundled scripts, references, assets, and provenance, so Skills.sh-style packs remain usable after import.
created_at: 2026-05-18T10:32:20Z
updated_at: 2026-05-18T10:49:46Z
---

## Problem

`kota skill import` can now ingest Skills.sh-style repo and directory packs, but
the installed representation still flattens each selected skill to one
`.kota/skills/<name>.md` file. That makes the prompt text resolvable, but it
drops the skill directory as the runtime artifact: bundled scripts,
references, templates, examples, assets, and any stable relative paths from
`SKILL.md` are not preserved.

Current peer skill ecosystems treat a skill as a directory with `SKILL.md` as
the entry point and optional resources beside it. A flattened import therefore
turns a valid multi-file skill into a partial prompt fragment. The next builder
who tries to use a skill that says "run `scripts/helper.py`" or "read
`references/schema.md`" will find that KOTA imported the instructions but not
the files that made the instructions executable.

## Desired Outcome

Imported skills keep their directory shape under `.kota/skills/`. A selected
pack skill installs as `.kota/skills/<name>/SKILL.md` plus the allowed bundled
resources from that skill directory, with provenance recorded in a durable,
auditable form. Runtime skill resolution uses the `SKILL.md` entry point from
that directory and gives the agent enough path information to follow local
references without re-fetching the source.

Single-file imports remain supported, but their canonical installed form is
still a skill directory rather than a flat markdown file. Existing imported
flat files either migrate through an explicit one-time loader path or fail
with an actionable diagnostic; do not silently support two long-lived storage
formats.

## Constraints

- Keep ownership in `skill-ops` and the existing imported-skill resolver. Do
  not add a second skill store or a background sync engine.
- Runtime skill resolution stays local-only. Network access belongs to the
  import command, not module load or prompt assembly.
- Preserve explicit-only activation for imported skills.
- Copy only files inside the selected skill directory. Do not import unrelated
  siblings from a multi-skill pack.
- Preserve relative references from `SKILL.md` where possible, but fail loudly
  on paths that would escape the installed skill directory.
- Treat bundled executable scripts as files available to the agent through the
  normal filesystem/tools boundary; do not auto-run them during import or
  prompt assembly.
- Keep provenance specific enough to audit the original source, selected
  skill path, imported files, and any files deliberately skipped.

## Done When

- `kota skill import <local-pack> --skill <name>` installs
  `.kota/skills/<name>/SKILL.md` plus allowed sibling resource files from that
  selected skill directory.
- GitHub repo/tree imports preserve the selected skill directory resources
  without fetching unrelated pack content.
- `readImportedSkillRecords` resolves directory-based imported skills and
  rejects malformed, duplicated, or path-escaping directory contents with
  actionable errors.
- `kota skill list` reports directory-based imported skills with their
  explicit activation state, resolvable/shadowed status, provenance, and
  resource-preservation summary.
- Flat legacy `.kota/skills/*.md` files have one explicit transition behavior
  covered by tests: deterministic migration, or a clear diagnostic that tells
  the operator how to re-import.
- Resolver-level tests prove an imported skill can refer to a bundled
  reference/script path and that the installed directory keeps that path
  available.

## Source / Intent

Explorer run `2026-05-18T10-29-22-808Z-explorer-wqek62` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Preserve imported skill resources as directories" --state ready --area modules --priority p2 --summary "Change imported skill storage and resolution from flattened markdown files to auditable skill directories that preserve SKILL.md plus bundled scripts, references, assets, and provenance, so Skills.sh-style packs remain usable after import."
```

It failed before writing a file because the workflow sandbox selected the stale
daemon client path and returned `Fatal: fetch failed`. This file follows the
normalized task schema manually.

External signal checked:

- https://code.claude.com/docs/en/skills describes skills as directories with
  `SKILL.md` plus optional supporting files, including templates, examples,
  scripts, and references.
- https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md
  shows Codex skill creation guidance using bundled `scripts/`, `references/`,
  and `assets/` directories.

Local evidence:

- `src/modules/skill-ops/skill-ops-operations.ts` writes each imported skill to
  `.kota/skills/<name>.md`, even when the source is a directory pack.
- `src/core/modules/imported-skills.ts` scans only `.kota/skills/*.md`, so the
  runtime resolver has no directory-shaped imported skill entry point.
- Recent completed tasks closed the narrower gaps for imported-skill runtime
  resolution and Skills.sh-style pack selection. This task is the remaining
  resource-preservation layer, not a second import mechanism.

## Initiative

Skill and module integrity: KOTA should import reusable guidance as the
artifact shape the ecosystem actually uses, while keeping one auditable local
resolver and explicit activation rule.

## Acceptance Evidence

- Focused `skill-ops` tests for local directory packs, GitHub repo/tree packs,
  selected-skill resource copying, skipped-file provenance, path-escape
  rejection, single-file import transition behavior, and `kota skill list`
  rendering.
- Resolver-level test proving a directory-based imported skill is injected only
  when explicitly named and preserves enough path context for bundled
  references/scripts.
- CLI transcript under `.kota/runs/<run-id>/` showing selected pack import,
  resource files present under `.kota/skills/<name>/`, `kota skill list`, and
  a resolver prompt assertion for the imported skill.
