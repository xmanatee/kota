---
id: task-foreign-extension-scaffold-python
title: Add Python scaffold to kota extension new for foreign subprocess extensions
status: backlog
priority: p3
area: extensions
summary: kota extension new creates a TypeScript in-process extension only. Adding --language python would scaffold a minimal Python KEMP subprocess extension, lowering the barrier for operators who prefer Python.
created_at: 2026-04-02T07:00:00Z
updated_at: 2026-04-02T07:00:00Z
---

## Problem

`kota extension new <name>` scaffolds a TypeScript in-process extension. Operators who
want to implement tools in Python (common for data science, ML, or scripting use cases)
must read `docs/FOREIGN-EXTENSIONS.md` and hand-write the KEMP protocol loop from
scratch. The stdio transport is fully supported and the protocol is documented, but there
is no starter template.

## Desired Outcome

`kota extension new <name> --language python` scaffolds a Python KEMP subprocess
extension with:

- `main.py` — implements the init/manifest/invoke/shutdown message loop over stdin/stdout
  using the NDJSON protocol. Exposes one sample tool (`hello_world`) as a concrete
  example.
- `requirements.txt` — empty (no runtime deps needed for the base protocol).
- `README.md` — brief usage instructions: how to register in `config.json` as a `stdio`
  foreign extension and how to add new tools.
- `.kota/config-snippet.json` — a copy-pasteable config fragment showing the `extensions`
  entry with the `stdio` transport pointing to `python main.py`.

The TypeScript scaffold path (`--language typescript`, default when flag is absent) is
unchanged.

## Constraints

- Python scaffold uses only stdlib (`sys`, `json`); no third-party deps.
- The generated `main.py` must handle concurrent invocations correctly
  (KEMP is request/response over a single stream — sequential handling is fine).
- The scaffold does not need to be tested end-to-end in CI; a unit test that the file
  is generated with correct content for each key file is sufficient.
- Do not modify the KEMP protocol or foreign extension loader — scaffold only.
- Update `docs/FOREIGN-EXTENSIONS.md` to mention the scaffold command.

## Done When

- `kota extension new myext --language python` creates a directory with the files above.
- `kota extension new myext` (no flag) still creates the TypeScript scaffold unchanged.
- `python main.py` in the scaffolded directory responds correctly to a hand-crafted
  `init` message piped to stdin (manual smoke test documented in README).
- Unit test verifies scaffold file names and key content patterns.
- `docs/FOREIGN-EXTENSIONS.md` links to the scaffold command.
