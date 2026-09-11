---
status: done
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


## Completion

Module manifest persistence, log storage, raw/keyed ModuleStorage access,
discovery metadata, saved-tool conversion, and runtime-health log collection
now use the shared anchored filesystem owner. Module identities and exact
filenames are validated; ambiguous keys are rejected without renaming their
legacy stored files. Deletion retains the shared module directory. Corrupt
logs remain visible errors and are preserved when retention cannot proceed.

Physical helper tests exercise no-follow opens, parent/leaf replacement,
failed installation/removal cleanup, and directory-name decoding. Domain tests
cover the reported reproductions, valid authoring/discovery, migration,
ordinary storage, distinct keys, and log retention. The production-runner
transcript in this run's artifacts demonstrates normal rendered output and
unchanged outside sentinels. Static checks and production TypeScript emission
pass; hosted module-log composition and scoped guidance checks also pass.

The all-repository check was attempted: its build cleanup could not remove the
pre-existing dist tree in the sandbox, so emission used a fresh run directory.
The broad test suite encountered localhost listen EPERM and other sandbox
failures and was stopped; full-suite success is not claimed. The filesystem
owner's directory-relocation and optimistic snapshot limits remain explicit.
Executable package installation/import and binary database adapters retain
their separate execution/storage ownership; an informational getDir path does
not grant this text-file boundary's guarantees to those operations.

Critic repair preserves installed module identities such as `audit.probe` as
lossless single path components. Installers validate the shared storage rule
before effects, and discovery/reload share loading behavior while authored
manifests retain their narrower policy. The repair's 316 selected tests cover
installer rejection, discovery/reload, storage/log identity, manifests,
authoring, loader lifecycle, and the physical filesystem race boundary. A fresh
production probe confirms dotted and neighboring modules load, retained data
stays unchanged, logs remain queryable, and reload observes changed code;
`repair-discovery-probe.mjs` and `repair-discovery-transcript.txt` are in the run
agent directory. Production/test typechecking and the remaining static gate
checks pass. The previously recorded broad-suite sandbox limits still apply.
