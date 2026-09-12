---
status: done
---
# Make contained evaluation setup executable through existing owners

## Outcome

Finish the deployable setup used by the existing contained-evaluation and model
matrix actions. Workers must be able to identify their actual prerequisites and
advance implementation without repeatedly publishing the same blocked receipt.
Do not create another execution bridge, queue, authority store or configuration
format. Compose the current host profiles, service installation, adapter auth,
container executor and module setup capabilities.

## Concrete gaps

- Builders `xqizqf` and `7pjlah` on September 12 reached the native actions but
  stopped because `KOTA_EVAL_CONTAINED_PROFILES` was absent. The existing service
  installer only retains PATH and NODE_OPTIONS, so the documented host grant has
  no supported installation journey. The tools are implemented; setup is not.
- AGY's adapter implements a macOS keychain locator but no isolated container
  authentication contract. Its availability probe builds independent executor
  options without carrying container auth. Supplying an image and Google proxy
  alone therefore cannot establish authenticated model discovery and execution.
- The retained AGY recipe asks for a Linux binary without obtaining it. The
  official installer publishes platform manifests and SHA-512 checksums. Use
  that verified distribution instead of copying the macOS executable.
- The rollout needs an exact model/adapter matrix, compatible images and local
  endpoint routing. Reuse the selection decoder and provider catalogs; do not
  invent an unverified generic profile or silently replace the native baseline.
- Scientific-claim run `vujk5d` hit the same absent grant at 17:17 UTC. Include
  the existing scientific-claim and algorithmic canary fixtures in the bounded
  Codex profile so each consumer does not repeat this setup investigation.

## Implementation boundaries

Provide one reproducible, reviewable deployment recipe for current KOTA and its
Linux dependencies, restricted provider proxy/network configuration, and the
scope-bound profiles. Use the existing service/configuration owner for installing
operator-authored grants. Repository writers must not authorize themselves or
gain a Docker socket, host keychain, broad home mount or unrestricted network.
Readiness should identify the failed prerequisite before spending model tokens.

Resolve authentication at the adapter boundary and use the same resolved contract
for availability and execution. Do not substitute paid Gemini API-key inference
for the subscription comparison without explicitly distinguishing the route.
If subscription authentication cannot be transferred through a vendor-supported
method, record that precise limitation and the smallest actual owner action;
do not manufacture a portable token or export the whole keychain.

Host preparation already produced `kota-probes:20260912`, image SHA-256
`44b8259792558edcb6973d8a7ee4fefe659982c188f6fa49dcd9de69a593d48b`, containing
the current compiled probe in `/opt/kota` and Linux dependencies. Image build
passed; container execution was denied by the coordinator's execution guard.
Do not bypass that guard. Keep source/setup implementation independent of live
deployment observation. Host installation and subsequent live measurements are
coordinator follow-up and the dependent benchmark tasks, not prerequisites for
publishing this implementation.

The coordinator installed `qwen2.5-coder:3b` through the existing Ollama service
and verified local inference at 17:23 UTC (returned `READY`). Its digest is
`f72c60cabf6237b07f6e632b2c48d533cef25eda2efbd34bed21c5e9c01e6225`.
Do not reinstall it or report an empty host model inventory. This is a local
readiness check, not a contained matrix result or model-quality endorsement.

## Acceptance

- An operator can prepare and install the supported grants using the normal
  service/setup owners; installation preserves existing settings and restarts.
- The recipe builds the matching runtime, verifies vendor binaries, and contains
  no credentials. Existing decoders validate the intended profile and matrix.
- Native availability and execution share authentication handling, with clear
  unsupported-provider results where appropriate. Worker requests cannot widen
  the grant. Fix existing owner-level tests where behavior changes; do not add
  another broad integration suite or tests asserting configuration literals.
- Record which deployment checks actually ran. Keep transcripts/build outputs
  in runtime artifacts, not copied source trees or tarballs committed into Git.
  The benchmark tasks retain their live quality and containment acceptance.

## References

- `src/modules/eval-harness/contained-evaluation.ts` and `contained-evaluation.md`
- `src/modules/eval-harness/agy-model-availability.ts`
- `src/modules/harness-parity/contained-matrix.ts`
- `src/modules/antigravity-cli-agent-harness/runtime-home.ts`
- `src/modules/codex-agent-harness/adapter.ts` (existing container auth contract)
- `src/modules/daemon-ops/service-install.ts`
- [Official AGY installation and authentication](https://www.antigravity.google/docs/cli/install/)

Google documents Linux installation and OS-keyring/remote OAuth authentication.
API-key mode additionally requires `modelProvider: gemini`; an environment key
alone does not enable it. Preserve that distinction in readiness and reporting.


## Completion

Implemented service-unit persistence of operator-authored contained profiles,
module setup readiness for missing/invalid/wrong-scope grants, and one deployment
recipe under `deploy/contained-evaluation/`. The recipe builds current Linux KOTA,
uses pinned Codex and SHA-512-verified Linux AGY distribution inputs, generates
restricted provider proxies, and validates the exact matrix through existing
catalogs, decoders and adapter routing. The bounded Codex profile includes both
requested fixtures. Existing units refuse overwrite; the documented operator
replacement journey retains their settings before reinstalling.

Availability now carries the execution owner's resolved container-auth contract
through the shared snapshot/mount/cleanup implementation. AGY subscription login
is explicitly unsupported by the current file-only contract: a vendor-supported
isolated Linux login and compatible adapter/keyring integration are required.
Gemini API credentials do not silently substitute for subscription access.

Builder run `2026-09-12T17-27-13-583Z-builder-i0sux2` retained deployment and CLI
transcripts in its run artifacts. `check:fast` passed; final production compilation
into the run directory and test typechecking passed. Owner tests passed 63 of 66
cases, plus all eight setup/probe cases. Three container-launch routing cases
could not launch because the sandbox denied `spawnSync /bin/ps`; the diagnostic
is retained, and these are not counted as passes. The real service install dry
run produced a plist whose grant JSON round-tripped exactly. The final generated
packet validates three profiles, 18 model labels, ten scenarios and two fixtures.
Synthetic vendor-acquisition checks accepted valid raw/archive Linux executables
and rejected mismatched checksums, architectures, non-Linux inputs and symlinks.

The ordinary build stopped at sandbox-denied cleanup of `dist`; compilation to
the writable artifact directory supplies scoped compiler proof, not a full build
claim. Actual AGY download/manifest verification, Docker image/Compose execution,
service activation and live model/containment measurements were not performed.
The outbound proxy and direct DNS attempts could not reach the vendor page; no
release URL or checksum was invented. The operator selects the official manifest
pins for the executable acquisition step. These deployment checks remain with the
coordinator and dependent benchmarks under the original implementation boundary.


## Critic repair

The shared container owner now applies namespace-capable sandbox options to
bound candidates as well as copied probes. Both drop all outer capabilities,
disable privilege escalation and write access to the image, bound process/swap
resources, and retain private PID/network isolation. Bound candidates run as the
workspace UID/GID so private runtime and read-only credential snapshots remain
accessible without added capabilities. The seccomp exception is explicit; no
SYS_ADMIN, privileged mode or host namespace is granted.

The production native candidate executor was exercised through its subprocess
port with controlled launch output, verifying native model/harness propagation,
namespace options, dropped capabilities and credential/workspace UID alignment.
Both shared transport contract cases passed, as did 12 preflight/auth/native
launch/availability tests. Five tests requiring real supervised subprocesses
failed before their intended observations in this sandbox; these are retained
as failures in the repair launch log, not hidden by the focused passing tests.
Live Docker/Bubblewrap execution remains coordinator validation, including
host kernel/LSM support and negative unintended-access checks. The deployment
guide explicitly distinguishes that native candidate journey from copied-source
probe success. Repair evidence is under the same builder run directory.


## Image toolchain repair

Codex now links directly to its installed JavaScript package entrypoint,
preserving package resolution. Pinned pnpm is installed under /opt/pnpm using
the repository dependency policy and linked directly; runtime homes no longer
depend on the bootstrap Corepack cache.

The Dockerfile adds an offline UID-1000 build check for both versions and the
algorithmic canary's visible pnpm test under fresh homes/cache locators. This
Linux image gate was authored but not executed here. Local relocated direct
entrypoint probes passed twice: pnpm 10.32.1, Codex 0.144.1 and the actual
algorithmic visible test. Corepack networking was disabled, the registry was
unavailable, and no Corepack cache was created. All Docker RUN shell bodies
passed syntax validation. These scoped checks repair the reproduced toolchain
defects; they do not claim a Linux image build, containment or live inference.
Evidence: repair2-toolchain.log and repair2-shell-validation.log under the
original builder run directory. No service, host grant or daemon changes ran.


## Native tool permission repair

Moved pinned pnpm and Codex package trees into /usr/local/lib, already readable
through the shared native runtime grants. Direct entrypoint links are retained;
no /opt permission grant or sandbox-policy exception was added. The image build
now resolves both command symlinks against the production native read roots and
generates the Codex permission profile. An image-local checker can additionally
run the actual algorithmic pnpm test through Codex's Linux tool sandbox with
that generated profile, without login, model inference or a new host launcher.

Production Linux root projection and Codex permission generation were exercised:
the new pnpm tree is granted, the old /opt/pnpm path remains outside the grants,
and network access remains disabled. JavaScript and Docker RUN shell syntax
checks passed. The image build and Linux sandbox command were not executed in
this macOS builder; the local sandbox CLI probe was denied at sandbox creation.
The authored image check distinguishes permission generation from executed
sandbox proof. Evidence is retained in repair3-permission-projection.log,
repair3-sandbox-help.log and repair3-syntax.log under this run directory.
