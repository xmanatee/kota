---
status: done
---
# Unify anchored record storage for decision owners

## Problem

At 763e14b14 approval-record-storage and owner-decision-record-storage maintain
six authored files / 1,192 LOC with 11 structurally matching function pairs.
They perform the same security-sensitive anchored record I/O, but have drifted:
approval-record-storage-helper-source.ts checks zero-progress writes and syncs
the directory; owner-decision-record-storage-helper-source.ts differs.
Both have real production consumers. This is duplicated authority, not just syntax.

## Desired Outcome

Extract the already shared anchored record I/O into one narrow core owner and
migrate both consumers. Preserve separate approval and owner-decision schemas,
signatures, lifecycle policy, paths and capabilities. Centralize containment,
file identity, read/write durability and process invocation where genuinely common.
Use an existing suitable secure I/O primitive if one already owns this contract;
do not introduce a competing filesystem security framework.

## Constraints

Retire both replaced helper implementations and duplicate mechanism tests in the
same change. No permanent adapters, generic storage DSL, broad repository-wide
rewrite, relaxed filesystem denials or swallowed I/O errors. Other filesystem
sinks, including the retained browser task, are not automatically equivalent;
do not expand scope without showing the same contract and authority.

## How We Will Know

Both real persistence owners use the common path. Shared proof exercises
symlink/hard-link rejection, target/ancestor identity replacement, partial or
zero-progress writes and durability through the actual owning boundary. Keep
only distinct domain lifecycle/signature tests in each consumer. Inspect all
imports/helper launch call sites to show no retired implementation remains.
Record what became simpler and the measured source/test delta.