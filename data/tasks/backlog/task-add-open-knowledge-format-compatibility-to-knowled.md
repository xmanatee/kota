---
id: task-add-open-knowledge-format-compatibility-to-knowled
title: Add Open Knowledge Format compatibility to knowledge
status: backlog
priority: p2
area: knowledge
task_class: Platform
summary: Let KOTA import, export, and validate OKF bundles through the existing knowledge store without replacing the canonical markdown/frontmatter data model.
created_at: 2026-06-24T15:44:37.311Z
updated_at: 2026-06-24T15:44:37.311Z
---

## Problem

Google's Open Knowledge Format formalizes the same broad shape KOTA already
uses for structured knowledge: markdown files with YAML frontmatter, readable by
humans and agents, diffable in git, and portable between systems.

KOTA's `knowledge` store is close enough that OKF should be an interoperability
win, but today there is no explicit OKF import/export/validate path. A future
agent that receives an OKF bundle must either treat it as arbitrary files or
manually copy content into KOTA knowledge entries, losing bundle structure,
links, and metadata.

## Desired Outcome

KOTA can consume and produce OKF v0.1-compatible bundles through the existing
knowledge provider. The implementation should make KOTA knowledge usable with
external OKF producers/consumers while keeping KOTA's current store as the
source of truth.

The finished surface should support:

- validating an OKF bundle enough to catch missing required `type` fields,
  malformed frontmatter, path traversal, and unsupported reserved-file use;
- importing concept markdown files into project or global KOTA knowledge
  entries while preserving useful metadata;
- exporting selected KOTA knowledge entries as an OKF bundle; and
- reporting any lossy mapping decisions explicitly instead of silently dropping
  metadata.

## Constraints

- Own this in `src/modules/knowledge/`. Do not move the knowledge store to OKF
  or add a second knowledge persistence layer.
- Keep canonical project data under KOTA's existing `.kota/data/` and
  `~/.kota/data/` locations unless the command is explicitly exporting a bundle
  to an operator-selected path.
- Preserve unsupported OKF fields as knowledge `meta` fields when they are
  string-compatible; report unsupported arrays/objects as lossy import details.
- Do not add external dependencies just to parse YAML if the current
  frontmatter helper is sufficient. If a parser is needed, keep it justified and
  isolated at the import/export boundary.
- Do not turn `index.md` or `log.md` into durable KOTA documentation catalogs.
  Use them only as OKF bundle metadata/navigation during import/export.
- Future agents should reread the current OKF spec before implementation
  because v0.1 is explicitly a draft.

## Done When

- `kota knowledge` exposes import/export/validate functionality for OKF bundles
  through local and daemon-backed paths, or an equivalent module-owned command
  path with the same behavior.
- OKF import maps required `type`, optional title/description/resource/tags/
  timestamp-style fields, body markdown, and local markdown links into KOTA
  knowledge entries without corrupting existing entries.
- OKF export produces a bundle that a simple OKF validator accepts, including a
  bundle-root `index.md` with `okf_version: "0.1"` when appropriate.
- Validation and import fail loudly on malformed frontmatter, missing concept
  type, path traversal, duplicate ids that would collide, and unsupported
  output paths.
- Tests cover import, export, validate, lossy metadata reporting, nested
  directories, `index.md`/`log.md` handling, and semantic reindex behavior after
  import.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
- https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
- https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/README.md

Local mapping:

- `src/modules/knowledge/` already stores markdown plus YAML frontmatter.
- `src/modules/knowledge-semantic/` indexes knowledge entries without changing
  canonical files.
- `docs/STANDARDS.md` explicitly names FAIR, W3C Data on the Web Best
  Practices, and SKOS as data-organization lenses, which fits OKF as an
  exchange format rather than a new service.

## Initiative

Portable agent knowledge: KOTA should be able to exchange structured reference
data with external markdown/frontmatter knowledge ecosystems.

## Acceptance Evidence

- Test transcript for knowledge OKF import/export/validate behavior.
- Fixture OKF bundle committed under the knowledge module test fixtures or
  generated in tests.
- CLI transcript under `.kota/runs/<run-id>/` showing validate, import, list or
  search, export, and validate-exported-bundle steps.
