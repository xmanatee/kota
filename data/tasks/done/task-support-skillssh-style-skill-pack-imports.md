---
id: task-support-skillssh-style-skill-pack-imports
title: Support Skills.sh-style skill pack imports
status: done
priority: p2
area: modules
summary: Teach kota skill import to ingest repo or directory based skill packs, including owner/repo shorthand and selecting individual SKILL.md entries, so KOTA can use the current skills.sh ecosystem without shelling out to a separate installer.
created_at: 2026-05-18T04:14:48.438Z
updated_at: 2026-05-18T04:29:34.362Z
---

## Problem

`kota skill import` now makes single markdown files usable by runtime skill
injection, but its source boundary is still narrower than the current agent
skills ecosystem. The command accepts a URL or local file and expects one
frontmatter-bearing skill markdown file. Skills.sh-style installs are repo or
directory based: operators run `npx skills add owner/repo`, optionally select a
single skill from a pack, and the installed artifact is commonly a directory
containing one or more `SKILL.md` files.

That leaves KOTA with an awkward gap after the imported-skill resolver work:
operators can use Skills.sh by shelling out to a separate installer and then
manually adapting files, but KOTA's own import command cannot ingest the
dominant source shape directly. The command should own that import boundary so
skill provenance, validation, explicit activation, and runtime resolution stay
inside one KOTA mechanism.

## Desired Outcome

`kota skill import` can ingest Skills.sh-style skill packs directly. It accepts
repo shorthand such as `owner/repo`, full GitHub URLs, local directories, direct
paths to a skill directory, and existing single-file sources. When a source
contains multiple skills, the operator can list or select explicit skill names
without installing unrelated prompt content.

Imported skills still land under `.kota/skills/`, show provenance in
`kota skill list`, and enter the existing imported-skill resolver path only
through the explicit activation rule. A successful import from a pack should be
indistinguishable at runtime from a valid single-file import except for richer
provenance.

## Constraints

- Keep ownership in `skill-ops` plus the existing imported-skill resolver. Do
  not add a second skill store, background sync engine, or separate Skills.sh
  runtime.
- Runtime skill resolution must stay local-only. Network access belongs to the
  import command, not module load or agent prompt assembly.
- Preserve explicit-only activation for imported skills unless a separate
  reviewed activation state is added with tests.
- Prefer deterministic source handling over invoking `npx skills add` as a
  subprocess. KOTA should not rely on another installer mutating hidden global
  skill directories.
- Fail loudly on ambiguous multi-skill imports unless the operator passes an
  explicit selector such as `--skill <name>` or `--all`.
- Keep provenance specific enough to audit: original source, selected skill
  path/name, and whether the import came from a single file, directory, or repo
  pack.

## Done When

- `kota skill import owner/repo --skill <name>` imports the selected
  `SKILL.md` from a repo-style skill pack and writes a validated
  `.kota/skills/<name>.md` file.
- `kota skill import <local-directory> --skill <name>` and direct
  `<local-directory>/<skill>/SKILL.md` imports work without network access.
- Multi-skill sources without `--skill` or `--all` return an actionable
  diagnostic that names the available skills instead of importing everything
  silently.
- Single-file URL and local-file imports keep their current behavior.
- `kota skill list` reports the imported skill as `sourceType: "imported"`,
  explicit-only, resolvable or shadowed as appropriate, and with pack-aware
  provenance.
- Resolver-level tests prove an explicitly selected pack skill is injected for
  an agent that names it and omitted from `skills: "all"`.

## Source / Intent

Explorer run `2026-05-18T04-12-14-948Z-explorer-9vt6ub` found an empty
ready/backlog/doing queue. The strategic blocked alternatives were all
operator-capture gated and non-movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External refresh showed that Skills.sh-style distribution is now the normal
install path for coding-agent skills. Vercel AI SDK recommends adding its agent
skill with `npx skills add vercel/ai`; CrewAI documents
`npx skills add crewaiinc/skills`; Skills.sh documents owner/repo installs,
full git URLs, direct skill paths, `--skill`, `--all`, and local folder
sources. KOTA already completed the narrower imported-skill resolver task, so
the remaining nonduplicative work is import-source compatibility, not another
skill runtime.

Research links:

- https://github.com/vercel/ai
- https://docs.crewai.com/en/skills
- https://skills.sh/docs/cli
- https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context

## Initiative

Skill and module integrity: KOTA should have one auditable mechanism for
importing and resolving reusable guidance, even as external skill distribution
shifts from single markdown files to repo-hosted packs.

## Acceptance Evidence

- Focused `skill-ops` tests for repo shorthand parsing, local directory import,
  multi-skill ambiguity, `--skill`, `--all` or the chosen explicit-all
  behavior, existing single-file compatibility, invalid pack diagnostics, and
  provenance rendering.
- Resolver-level test proving a pack-imported skill is injected only when an
  agent names it explicitly.
- CLI transcript captured under `.kota/runs/<run-id>/` showing pack listing or
  ambiguity output, selected import, `kota skill list`, and a resolver prompt
  assertion for the imported skill.
