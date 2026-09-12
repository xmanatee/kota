# Contained evaluation from a native workflow

From an admitted native writer, inspect the host's available profiles:

```sh
pnpm kota eval contained '{"operation":"inspect"}'
pnpm kota eval contained '{"operation":"probe","profile":"linux","probeId":"browser"}'
pnpm kota eval contained '{"operation":"run","profile":"routing","fixtureIds":["fixture-id"],"repeatCount":1}'
pnpm kota eval contained '{"operation":"agy-models","profile":"agy","candidates":["catalog-model-id"],"repeatCount":1}'
```

The command uses the invocation's existing request/reply service. The worker
receives no daemon token, database access, Docker socket, or host shell. The
host checks the current run attempt and scope tool policy on every call.
Only explicitly opted-in module tools are callable. An older host reports that
its runtime must be updated; publication and a new host invocation provide the
capability without a worker restarting its parent.

The [deployment recipe](../../../deploy/contained-evaluation/README.md) builds
matching images and prepares validated grants and catalog-derived proxy rules.
The normal service installer retains the reviewed grants across restarts;
module Setup reports missing or invalid scope grants.

The operator supplies `KOTA_EVAL_CONTAINED_PROFILES` as a JSON map in the trusted
host environment. A profile authorizes canonical scope roots, the existing
preset, fixture ids or AGY candidate ids, repeats, deadline, CPU and memory, and
the existing eval API's container backend. The decoder in
[contained-evaluation.ts](contained-evaluation.ts) is the configuration reference.
Request bodies select among these grants and cannot alter them.

For deterministic checks, use a separate offline profile. Its `probes` map names
commands accepted by the existing Runtime Probe parser and the source paths each
command needs. For example, a host profile can authorize:

```json
{
  "linux": {
    "scopeRoots": ["/absolute/canonical/scope"],
    "timeoutMs": 120000,
    "cpuCores": 2,
    "memoryMB": 2048,
    "isolationBackend": {
      "kind": "container",
      "executable": "docker",
      "image": "kota-probes:current",
      "kotaBinaryPath": "/opt/kota/bin/kota.mjs",
      "networkPolicy": { "kind": "offline" }
    },
    "probes": {
      "browser": {
        "command": "pnpm run test:owner src/modules/browser",
        "sourcePaths": ["src", "test", "package.json", "vitest.config.ts", "tsconfig.json"]
      }
    }
  }
}
```

The runtime reads these paths from the invoking writer's working directory.
Directory selections recurse; reads reject symbolic links and hard links, skip
hidden/runtime entries, and accept UTF-8 source files up to 128 KiB each, with a
32 MiB total limit. Dependencies and built output come from the trusted image.
The resulting source digest and per-file hashes identify the exact transferred
cohort, including uncommitted corrections. A failed or changing read fails the
invocation instead of falling back to canonical source.
The image decodes stdin across byte-chunk boundaries and checks the received
source digest before materializing files or starting the probe.

Prepare a clean Linux image containing the current KOTA production build and a
self-contained `node_modules` tree under `/opt/kota`, plus Node, the pinned pnpm,
and `ps` (procps). Include tools required by the selected checks, such as
Bubblewrap/prlimit or Ruby. Do not bake credentials into this image. Its files
must be readable by uid 1000. The launcher copies image dependencies and source
into a bounded private tmpfs with `exec` for native addons and copied executables,
and `nosuid,nodev` retained; no host bind mount or Docker socket enters it.
It runs with no network, no capabilities, a read-only image, and no privilege
escalation. Unprivileged user namespaces are allowed so OS-boundary tests can
exercise Bubblewrap; this does not grant host namespaces or devices. Linux with
a non-piped `core_pattern` is required before candidate code starts.

Browser persistence can select its positive and relocation-adversarial owner
checks through this profile. Those checks still own the persistence acceptance;
the transport does not certify a writer implementation. Package installation and
image preparation are host setup, never worker-supplied commands. An unavailable
image returns the existing launcher's image-inspection diagnostic.

On the host, verify the actual native transport, Linux confinement, returned
writer-source result and cancellation cleanup with the maintained integration
case, using that prepared image. The smoke also queries the copied `better-sqlite3`
native addon, executes a Node binary copied into the workspace, and hashes a
large Unicode source payload after materialization:

```sh
KOTA_TEST_CONTAINED_PROBE_IMAGE=kota-probes:current pnpm test:integration src/contained-evaluation.integration.test.ts
```

Without the explicit image this one Docker case is skipped; the authorization
and failure-return integration case remains deterministic and runs normally.
Publication and host activation precede this deployment check; a builder does
not restart its parent daemon to activate changed tools.

For model evaluations, prepare the image with the selected adapter and KOTA's package layout, including
its image-local `bin/kota.mjs` and `dist`. Use an image that supports that adapter's
nested sandbox. Configure the backend's `networkPolicy` as `provider-egress`,
with the provider and `docker-internal-proxy` enforcement. The candidate joins
an **internal** Docker network; its proxy is the only permitted route to the
provider endpoints. The network must carry the labels and endpoint values
exported by [provider-egress.ts](provider-egress.ts). Labels document the intended
policy; actual proxy enforcement and positive/negative connectivity probes still
establish containment. Local endpoints use the model-clients routing owner.

The existing runner checks executable, image and network availability and
returns its specific setup diagnostics. Adapter-owned login locators and
provider auth remain host-resolved; do not put credentials or host mount paths
in requests. Scoring still runs offline. Configuration and a completed call do
not by themselves establish model quality or gate eligibility.

Results include the originating workflow/run/step and a readable artifact path
under that run's `native-tool-artifacts`. Request, result or failure evidence
remains there after the invocation closes. Await a call before issuing another.
Removing its request or ending the native invocation cancels evaluation and
waits for owned cleanup. A container server outage retains cleanup ownership;
restart recovery removes registered resources before another attempt can run.

Harness-parity contributes the model-matrix action through this same native
invocation service:

```sh
pnpm kota harness-parity contained '{"operation":"inspect","profile":"rollout"}'
pnpm kota harness-parity contained '{"operation":"run","profile":"rollout","repeatCount":3}'
```

Use a model profile with an explicit `preset` and add a `matrix` selection. The
shared host-profile schema retains this field; harness-parity's
[selection decoder](../harness-parity/contained-matrix.ts) owns its validation.
It declares `baselines` and `candidates` as `{label, model, provider}` records,
`harnesses` as the compatible adapter pool, and `harnessesByLabel` as the exact
allowed adapters for every model label. For example the GPT-5.5 baseline label
selects only `codex`, while a local label may select both `openai-tools` and
`openai-tools-scaffold`. This prevents an API route from silently becoming the
native baseline. Explicit `scenarios` and `evalFixtures` arrays fix the cohort;
an empty array selects none. `evalIsolationBackends` supplies a provider-egress
container for each execution provider, using the existing isolation schema.
All rows share the profile's CPU, memory, deadline and repeat grant. Optional
`effort` and `maxTurns` remain host-selected. The worker cannot override models,
cohorts, images, network policy, credentials or artifact locations.

Matrix execution reuses the existing pairing, aggregation and fixture runner.
The trusted host resolves adapter declarations and credentials before its shared
blocking worker runs. Scenario agents launch through the same eval container
command/auth owner; their verifier and diff commands run in separate offline
containers. The image must contain the matching `harness-parity contained-stage`
entrypoint. Scenario `verification.trustedFiles` declarations protect scorer
files through read-only overlays and reject candidate relocation. Results,
profiles, transcripts and failure evidence return under the originating run.
The existing native tool authorization and process/resource cleanup apply to
`contained_model_matrix`; there is no additional service or queue to configure.
No model is promoted by these artifacts alone, and non-gating egress stays
non-gating. Live positive inference and negative confinement checks still apply.
