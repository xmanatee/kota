---
status: open
priority: p1
---

# Confine module files to their owning storage and preserve file identity

## Confirmed failures

Reproduced on main `0fa8700c8`, September 11, 2026, using disposable directories:

- Make `<scope>/.kota/modules/audit-probe` a symlink to an outside directory
  containing a valid `manifest.json`. Run `runModuleFactory` with that scope as
  `cwd` and `scopeRoot`: `info` reads the outside manifest; `create` overwrites
  it; `remove` deletes it. A valid module name and an atomic JSON write do not
  confine these operations. These probes invoked the production runner directly;
  they establish the persistence failure, not a bypass of every deployment gate.
- Query module logs with `name: "../../../outside"` and the log store reads
  `<scope>/../outside/logs.jsonl`. The tool schema admits the traversal string.
- `new ModuleStorage(scope, "storage-probe").writeFile("../../../escaped.txt",
  "sentinel")` creates `<scope>/escaped.txt`, outside the module directory.
- `setJSON("first/key", first)` followed by `setJSON("first?key", second)` makes
  `getJSON("first/key")` return the second value: lossy filename sanitization
  aliases distinct keys.

## Required outcome

Give module persistence one consistent filesystem boundary, while keeping
manifest decoding, log formatting and module-owned data schemas with their
existing owners. Inspect `src/core/manifest/persistence.ts`,
`src/core/modules/module-log.ts`, `module-storage.ts` and their discovery,
authoring and saved-tool migration callers.

Constrain module names, keys and exact filenames before I/O. Reject invalid
identities or encode them reversibly; never silently alias distinct keys.
Constrain reads, writes, listing, pruning and deletion to the intended module
storage, including symlinked ancestors and leaves. Use the existing anchored
filesystem owner where its documented guarantees fit; keep authorization in
the caller. A lexical prefix check or preflight `realpath` alone is insufficient.
Respect the helper's documented directory-relocation limits rather than claiming
a stronger atomic guarantee. Preserve existing valid data and report malformed
or inaccessible storage distinctly from absence.

Do not build a new storage service or copy the anchored filesystem helper into
each module. Assess current key callers and stored names before changing their
representation; do not silently rename or discard existing values.

## Acceptance

- Each reproduction is rejected or safely confined; outside sentinels remain
  unchanged through read/write/remove and failed cleanup paths.
- Valid module authoring, discovery and ordinary storage operations still work;
  distinct admitted keys retain distinct values.
- Exercise physical no-follow/race guarantees at the shared filesystem owner;
  retain small integration proofs for manifest authoring and log/storage callers.
- Enumerate and close direct filesystem paths that bypass the chosen boundary.

The tool-target task owns policy target resolution; the module-log scope task
owns selecting the correct scope's store. The existing browser-profile task
owns its stricter credential-publication boundary and remains separate.
