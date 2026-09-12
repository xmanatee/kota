---
status: done
---
# Run existing deterministic runtime probes on the available Linux container backend

## Problem

Native workers on this Mac cannot launch nested OS sandboxes or access Docker.
The host can: the September 12 monitor executed the existing database/absent-state
confinement checks successfully in a disposable Linux container. Browser credential
persistence remains unfinished because workers cannot exercise its real boundary.
This is missing internal execution mediation, not missing owner permission.

## Outcome

Make the existing deterministic task-probe/verification path usable through the
shared native tool mediation delivered by the predecessor. Inspect the current
task-probe runner, contained-workspace resolver, eval container launcher and module
tools first. Extend their existing owners; do not build another command service,
scheduler, protocol, per-task permission flag or evidence-request workflow.

The host selects an isolated current-source Linux environment. A task can execute
its scoped synthetic checks and receive their results without host mounts, raw
credentials, Docker socket access, production daemon control or arbitrary host
commands. Existing supervision, cancellation, attribution and cleanup must apply.
Image/setup discovery should identify actionable configuration, not ask for captures.

## Acceptance

- A native workflow invokes a deterministic synthetic verification through the
  maintained tool/probe boundary; actual Linux confinement and result return run.
- Browser persistence can use it for positive and relocation-adversarial checks.
  That consumer still owns implementing and verifying its writer.
- Scope widening and host-command escape remain denied. Cancellation cleans up.
  Reuse owning tests; do not repeat every module or create a parallel test suite.
- Publish implementation using proportionate local proof. The host monitor verifies
  activation and configures the existing host-owned backend; do not require a
  builder to restart its own parent or produce future deployment evidence.

## Implementation and verification

The existing `contained_evaluation` native tool now accepts a named deterministic
probe from a host-owned offline profile. The eval module collects the invoking
writer's selected source using anchored reads, records its digest, and sends the
content to the existing container launcher over stdin. The shared task-probe
runner supplies result semantics; the workflow blocking operation and durable
resource owner supply cancellation and container cleanup. No worker-supplied
command, source root, image, mount, credentials or network setting is accepted.

Browser persistence can select its positive and relocation-adversarial owner
checks through this path. Its writer implementation and acceptance remain with
that consumer. Host profile/image setup and the actual Docker integration case
are documented in `src/modules/eval-harness/contained-evaluation.md`.

Local proof includes native transport authorization and attributable failure
return, current-writer source collection, link/escape rejection, resource-bounded
offline launch arguments, registered cleanup, and existing cancellation/recovery
tests. Static checks, production compilation and asset copying pass. The selected
owner runs passed 39 checks plus 26 broader checks; seven existing process-launch
checks could not pass the worker's `/bin/ps` denial. No process identity check
was bypassed. The native integration case passed; its explicit real-Docker case
was skipped because no host test image was supplied.

A real call from this native workflow reached the host and returned the specific
missing `KOTA_EVAL_CONTAINED_PROFILES` setup error. This is evidence of mediation,
not of Linux execution. Per the task's publication acceptance, host activation,
profile/image configuration and the actual Linux smoke remain deployment
follow-up; this builder did not restart its parent or claim that follow-up passed.
Run evidence is retained with `2026-09-12T14-17-35-526Z-builder-a8qetc`.

Critic repair: the private workspace tmpfs explicitly permits execution while
retaining `nosuid,nodev`, so copied native addons and binaries can run. The
existing launch check failed for the missing `exec` option before the repair and
passes with it. The maintained Docker smoke now queries `better-sqlite3` resolved
inside the copied dependency tree and executes a Node binary copied into the
workspace. Native authorization/failure-return integration still passes; the
extended real-Docker smoke remains host activation follow-up, not a claimed pass.

Source-transfer repair: anchored text reads now reject malformed UTF-8 bytes
without rejecting a literal U+FFFD character or stripping a BOM. Probe collection
uses that shared decoder and retains its NUL rejection. The documented browser
profile's actual source selection collected 3,954 files (21,926,336 bytes),
including the web-access fixture that exposed the failure, with byte-for-byte
preservation of that fixture. The pinned cohort and hashes are recorded in
`repair2-current-source.json` under this run. Nineteen focused checks passed,
covering decoding, collection and existing anchored filesystem safety; this
source-collection result does not claim Linux execution.

Stream-transfer repair: the image-side receiver now decodes streaming JSON
without losing multibyte characters split across stdin chunks and validates the
received source digest before materialization or execution. Seven owner checks
pass, including a 23 MB Unicode transfer and rejection of altered content. Three
subprocess runs of the compiled receiver preserved the complete payload bytes
(`repair3-stream-proof.log`). The maintained Docker smoke additionally hashes
the materialized Unicode files and compares the returned cohort digest against
the writer's source. Its actual Docker execution remains unperformed host
activation follow-up.
