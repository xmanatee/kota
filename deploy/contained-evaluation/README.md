# Contained evaluation host setup

Run preparation from the reviewed KOTA checkout on the deployment host. These
files compose the existing service installer, host profiles, adapter auth and
container executor. They do not install authority into a repository or let a
writer start Docker. Host installation and live measurements belong to the
coordinator and the dependent benchmark tasks.

## Prepare runtime images

Use Docker with a Linux kernel supporting the selected native adapter's nested
sandbox. Verify unprivileged user namespaces and a non-piped `core_pattern`
through the existing contained probe before candidate execution. That offline
probe alone does not verify the native candidate path. A guard denial
is a deployment diagnostic; do not disable the guard or grant a worker the
Docker socket. Node 24 supplies environment-proxy transport; the recipe installs
Linux native dependencies with the committed pnpm lockfile and dependency policy.
Corepack is used only to bootstrap installation. The image exposes the pinned
pnpm package and Codex JavaScript entrypoints under /usr/local/lib, within the
existing native sandbox runtime read grants. No /opt read grant is added. Thus
pnpm shell-shim paths and build-user caches are not runtime dependencies. An offline build check runs
both commands as UID 1000 with fresh homes/caches, then executes the algorithmic
canary's visible pre-run test. It also generates the production native permission
profile and rejects tool symlink targets outside its read grants. A failure
stops image construction.

After the image is launched through the approved contained execution owner,
run this image-local check with its normal candidate sandbox options:

```sh
node /opt/kota/deploy/contained-evaluation/verify-native-toolchain.mjs
```

It materializes the algorithmic fixture, generates permissions through the same
native sandbox and Codex profile owners used by the adapter, and runs pnpm test
through Codex's Linux tool sandbox without login or model inference. The build
uses its --check-grants mode because ordinary image-build isolation does not
provide the candidate's nested-namespace contract. A grant-generation pass is
not reported as a sandbox execution pass.

The shared container launcher enables unprivileged namespace syscalls for both
copied probes and bound candidates. It drops all outer capabilities, disables
privilege escalation, keeps the image read-only and uses a private temporary
filesystem. Bound candidates run as their workspace owner, including access to
the private read-only login snapshot. No SYS_ADMIN capability, privileged mode
or host PID/network namespace is granted. Docker's default seccomp filter cannot
support this nested sandbox, so the launcher explicitly uses an unconfined
seccomp filter; capability removal and the outer container remain required.
Host kernel/LSM policy must permit unprivileged user namespaces. A denial remains
a failed prerequisite; do not disable the coordinator's execution guard.

After activation, verify the native baseline through the existing contained
evaluation action, including actual sandboxed tool execution and rejected
unintended access. A copied-source probe or API-only candidate cannot establish
that result.

From the checkout root, select the same pinned Codex CLI version as the native
baseline (`codex --version` on the trusted host). Record the source revision,
version and complete build output under the deployment run's artifact directory:

```sh
# CODEX_VERSION is the reviewed numeric version, not "latest".
docker build --target runtime --build-arg CODEX_VERSION="$CODEX_VERSION" \
  -f deploy/contained-evaluation/Dockerfile -t kota-eval:review .
docker build --target proxy \
  -f deploy/contained-evaluation/Dockerfile -t kota-proxy:review .
docker image inspect kota-eval:review kota-proxy:review
```

The adjacent Docker ignore file admits only source/build inputs. It excludes
host dependencies, operational state and environment files. The image compiles
this checkout and includes `/opt/kota/bin/kota.mjs`, `dist`, fixture assets and
self-contained Linux dependencies. It never embeds login data. Retain the final
image digests and use them instead of mutable tags in the reviewed grants.
Base tags and Debian repositories may change: archive their resolved digests and
package versions with build output when an exact rebuild is required.

AGY uses its own build target. From Google's [official installation
page](https://www.antigravity.google/docs/cli/install/), select a Linux entry for
the Docker target architecture in the published platform manifest. Preserve the
manifest URL/content and select its download URL and SHA-512 checksum. These
public release pins are build arguments, not a new KOTA configuration format:

```sh
docker build --target agy --build-arg CODEX_VERSION="$CODEX_VERSION" \
  --build-arg AGY_LINUX_URL="$AGY_LINUX_URL" \
  --build-arg AGY_LINUX_SHA512="$AGY_LINUX_SHA512" \
  -f deploy/contained-evaluation/Dockerfile -t kota-agy:review .
```

The image build downloads the release itself, verifies SHA-512, accepts a raw
ELF or a tar archive containing one regular `agy`, and checks Linux architecture
before installing it. A missing pin or checksum/architecture mismatch stops the
build. Do not copy the host macOS executable or invent a checksum. The selected
manifest entry is the provenance authority; a hash alone is not vendor identity.
Record the selected manifest, download verification and image build output in
the deployment artifacts before claiming that image is ready.

## Prepare and review scope grants

```sh
node --conditions=source --import tsx deploy/contained-evaluation/prepare.mjs \
  /absolute/canonical/scope kota-eval:review kota-proxy:review kota-agy:review \
  /absolute/new/deployment-packet
docker compose -f /absolute/new/deployment-packet/compose.json config
```

Preparation loads the canonical fixture/scenario decoders, OpenRouter candidate
catalog, provider endpoint catalog and contained profile/matrix decoders. It
writes a new packet and refuses to overwrite one. Review `profiles.json` before
installation. It fixes all shipped parity scenarios, the scientific-claim and
algorithmic fixtures, three repeats, equal resources, the native GPT-5.5/Codex
baseline and raw/scaffold candidate routes. Explicit labels prevent an API
adapter from replacing the native baseline. No global effort override is added:
provider defaults apply, including local routes without effort support. Catalog
membership does not establish current model availability; matrix admission
performs its normal freshness, routing and auth checks before inference.

The local row uses the already installed `ollama/qwen2.5-coder:3b`. The
coordinator recorded successful local inference on September 12 at 17:23 UTC;
its digest was `f72c60cabf6237b07f6e632b2c48d533cef25eda2efbd34bed21c5e9c01e6225`.
Do not reinstall it. This host observation is not a contained matrix result.

The Compose input starts only provider proxies. Every candidate network is
internal and has catalog-derived labels. Only the proxy joins the upstream
network. Exact host/port rules end in deny-all; TLS uses CONNECT and the local
route permits HTTP only to `host.docker.internal:11434`. No proxy port is
published on the host. On Linux, ensure Ollama is reachable from the proxy's
host-gateway address with host firewall restrictions; a loopback-only listener
is insufficient. Do not expose Ollama publicly. Candidate endpoint selection
remains in `model-clients/local-container-routing.ts`.

## Install through the existing service owner

After review, the operator activates proxies and supplies the same JSON map to
the normal service installer:

```sh
docker compose -f /absolute/new/deployment-packet/compose.json up -d
export KOTA_EVAL_CONTAINED_PROFILES="$(cat /absolute/new/deployment-packet/profiles.json)"
pnpm kota daemon install --scope-root /absolute/canonical/scope --dry-run
pnpm kota daemon install --scope-root /absolute/canonical/scope
```

The installer persists the map alongside PATH and NODE_OPTIONS in the user
launchd/systemd unit, escaping each service format. Restarts retain these
settings. It does not copy arbitrary environment secrets, edit scope config or
overwrite an existing unit. For an existing service, retain the old unit and
its PATH/NODE_OPTIONS, stop it through the operator's normal lifecycle, use
`kota daemon uninstall`, then reinstall with the retained settings plus the
reviewed profile map. Restore the saved unit if installation fails. Custom
service settings must be carried forward by their operator; the installer
refuses silent replacement. Builders do not perform this activation.

Codex login resolves through its adapter's host-owned auth-file locator. Only
the credential snapshot crosses into the candidate container; no host home or
session store does. Store OpenRouter credentials through the existing secret
setup owner in the canonical scope. Do not put secrets in profiles, Compose
inputs, build arguments, service dry-run transcripts or images.

`kota setup list` exposes whether a valid grant exists
for the selected scope. This capability reports grant configuration, not full
runtime readiness. The native `eval contained` and `harness-parity contained`
inspect operations remain the worker discovery surfaces. Execution then reports
the first failed image, auth, proxy/network or resource prerequisite before
model tokens are spent. Requests cannot widen a profile.

## AGY subscription limitation and live follow-up

AGY stores subscription login in an OS keyring. KOTA's file-only container auth
contract cannot transfer that login or complete isolated Linux remote OAuth.
The adapter now rejects contained discovery and execution with that precise
limitation, even if a Gemini API key exists. Image preparation and a Google
proxy do not make the subscription route authenticated. The smallest operator
step is to establish the vendor's supported login in the isolated Linux runtime;
a supported adapter/keyring contract must then integrate it without exposing
host keychains or inventing portable tokens. Do not keep retrying benchmark
calls against the current unsupported route.

Paid API mode additionally requires AGY `modelProvider: gemini`. It is a
separate comparison route and is not silently enabled by environment keys.
The native host AGY login path remains unchanged.

After host activation, dependent benchmark tasks collect positive inference,
negative unintended network/credential access, offline scoring and cancellation
cleanup using the existing contained invocation and probe owners. Inspect the
returned measured source/runtime identity and resource evidence. Network labels,
build success, grant readiness and denied calls do not establish containment or
model quality. Keep these transcripts and results in runtime artifacts; never
commit copied source trees, tarballs or credentials as evidence.
