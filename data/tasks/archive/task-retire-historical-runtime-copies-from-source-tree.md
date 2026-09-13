---
status: done
---
# Separate retained run evidence from maintained repository fixtures

## Evidence

At `ab2889452`, Git tracks 1,697 files under `.kota/runs/` across 227 directories,
totaling 12,236,833 bytes. Builder `xqizqf` alone contributed 72 files including a
5,539,584-byte build tarball and 51 copied source inputs. In contrast, the small
eval fixtures and scoped reference examples have real behavior consumers.
`production-routing-replay.integration-test-helpers.ts` also directly reads a
historical tracked run for two suites. Blanket deletion would break those proofs.

## Outcome

Remove historical runtime packets and reconstructible build/source copies from
the maintained Git tree, after preserving needed originals through existing run
retention and artifact handoff. Reference immutable repository revisions for
reconstructible source; preserve exact private originals when a revision cannot
reproduce an observation. Existing retention owns eventual disposal.

Move only the minimal redacted inputs required by maintained replay consumers
into their owner's fixtures with provenance, and remove their dependency on a
historical live run directory. Do not turn a large run into a large renamed
fixture. Trace actual consumers and current task references before retirement.
Do not delete active/retained writers, owner files, useful private captures or
entire `.kota/` directories. Avoid rewriting historical commits.

`RunLifecycle` already rejects new/modified runtime packets during publication.
Keep and correct that owning boundary if a bypass is demonstrated; do not invent
another evidence registry, duplicate guard, or blanket prohibition on fixtures.

## Acceptance

Ordinary runtime packets no longer need Git tracking or source-tree copies;
required historical observations remain retrievable with existing access controls.
Replay consumers use small explicit fixtures, while unrelated live runs and
claims remain untouched. Show tracked-file/byte changes and verify the affected
replay and handoff owners. A fresh writer cannot republish the retired clutter.
No optional AGY benchmark or new capture format gates this cleanup.

## Completion

Retired all 1,697 tracked `.kota/runs/` files (12,236,833 bytes) from the
maintained tree. The only source consumers used two redacted production-routing
captures; those 116,691 bytes now live as explicit autonomy-owner fixtures with
their source run, first repository revision, and projection boundary recorded.
Their semantic payloads match the historical captures exactly.

The retired tree remains retrievable at immutable repository revision
`52bc17b8d50fcb15b9fd29cf50978ab994089cc9` (and at the task's cited
`ab2889452`). Existing runtime retention remains authoritative for private
originals; this isolated writer neither read nor changed live/retained runtime
state. The replay consumer, artifact-handoff contract, and `RunLifecycle`
publication guard were exercised. The completion replay and guard passed; the
dead-letter replay loaded and validated the migrated fixture but its unchanged
asynchronous observation timed out. `pnpm check:fast` passed.
