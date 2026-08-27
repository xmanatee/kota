---
status: done
---

# Add Python scaffold to kota module new for foreign subprocess modules

## Problem

`kota module new <name>` scaffolds a TypeScript in-process module. Operators who
want to implement tools in Python (common for data science, ML, or scripting use cases)
must read `docs/FOREIGN-MODULES.md` and hand-write the KEMP protocol loop from
scratch. The stdio transport is fully supported and the protocol is documented, but there
is no starter template.

## Desired Outcome

`kota module new <name> --language python` scaffolds a Python KEMP subprocess
module with:

- `main.py` — implements the init/manifest/invoke/shutdown message loop over stdin/stdout
  using the NDJSON protocol. Exposes one sample tool (`hello_world`) as a concrete
  example.
- `requirements.txt` — empty (no runtime deps needed for the base protocol).
- `README.md` — brief usage instructions: how to register in `config.json` as a `stdio`
  foreign module and how to add new tools.
- `.kota/config-snippet.json` — a copy-pasteable config fragment showing the `modules`
  entry with the `stdio` transport pointing to `python main.py`.

The TypeScript scaffold path (`--language typescript`, default when flag is absent) is
unchanged.

## Constraints

- Python scaffold uses only stdlib (`sys`, `json`); no third-party deps.
- The generated `main.py` must handle concurrent invocations correctly
  (KEMP is request/response over a single stream — sequential handling is fine).
- The scaffold does not need to be tested end-to-end in CI; a unit test that the file
  is generated with correct content for each key file is sufficient.
- Do not modify the KEMP protocol or foreign module loader — scaffold only.
- Update `docs/FOREIGN-MODULES.md` to mention the scaffold command.

## Done When

- `kota module new myext --language python` creates a directory with the files above.
- `kota module new myext` (no flag) still creates the TypeScript scaffold unchanged.
- `python main.py` in the scaffolded directory responds correctly to a hand-crafted
  `init` message piped to stdin (manual smoke test documented in README).
- Unit test verifies scaffold file names and key content patterns.
- `docs/FOREIGN-MODULES.md` links to the scaffold command.
