---
status: open
priority: p1
---
# Keep native sandbox policies launchable with retained evidence

## Evidence

At `2026-09-13T00:03:28.272Z`, the continuation judge for
`2026-09-12T23-34-27-704Z-builder-zonxlu` failed during Codex thread creation:
`sandbox-exec: data object length 154882 exceeds maximum (65535)`.
The shared continuation path reported `needs-owner` despite this being a
technical launch failure, not an ambiguous product decision. Activation then
restarted the daemon and recovered the same builder; recovery is not proof
that subsequent judges or long-running sessions avoid this failure.

## Outcome

The September 13 monitor reproduced the failure in Codex's generated permission
profile, not KOTA's outer sandbox. The retained zonxlu manifest contained 4,016
available projections, largely copied compiled output. Individual evidence
grants produced 4,017 paths and 772,250 configuration bytes; native policy
compilation failed before any model turn.

The shared handoff now preserves and verifies those immutable projections but
delivers their selected content in bounded, content-addressed review files.
The actual retained snapshot produced two grants and 1,367 configuration bytes;
native Codex execution succeeded while direct raw-original access was denied.
The eight owner cases and both existing process/native composed evidence cases
passed. Do not repeat this policy repair or invent a second evidence protocol.

Remaining work is the technical-failure classification below and confirming
ordinary, critic and continuation calls use this corrected shared boundary.
Avoid retaining generated compiled trees as review evidence when the existing
artifact selector can identify the actual verification output. Preserve required
originals and citations through their existing owner.

Remove redundant grants and unnecessary per-file expansion at their owner,
or use the existing isolated evidence projection where exact authorization
requires it. Keep authority no broader than the original contract: granting
an ancestor directory is not a valid compaction if it exposes siblings,
credentials, canonical state or another run. Do not disable the sandbox,
truncate denials, clear useful sessions, or add a parallel launch service.

## Acceptance

A representative large retained-evidence run launches ordinary and judge
calls through the supported native path while preserving read/write and
cross-run isolation. Host execution restrictions remain explicit qualification
limits, not synthetic passes. Consolidate verification at the shared policy
owner and one real launch boundary, rather than repeating it per automation.

An infrastructure failure before a judgment remains attributable through
existing runtime issue/retry handling; it is not a successful judgment or a
request for a nonexistent owner decision. Retry only where the existing
recovery contract supports it, preserve useful work, and avoid an unchanged
launch/restart loop. Confirm progress after the correction, not just a smaller
serialized policy. No new issue store or continuation protocol is needed.
