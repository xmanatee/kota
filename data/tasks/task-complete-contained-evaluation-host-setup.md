---
status: open
priority: p1
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
