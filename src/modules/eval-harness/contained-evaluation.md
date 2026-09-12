# Contained evaluation from a native workflow

From an admitted native writer, inspect the host's available profiles:

```sh
pnpm kota eval contained '{"operation":"inspect"}'
pnpm kota eval contained '{"operation":"run","profile":"routing","fixtureIds":["fixture-id"],"repeatCount":1}'
pnpm kota eval contained '{"operation":"agy-models","profile":"agy","candidates":["catalog-model-id"],"repeatCount":1}'
```

The command uses the invocation's existing request/reply service. The worker
receives no daemon token, database access, Docker socket, or host shell. The
host checks the current run attempt and scope tool policy on every call.
Only explicitly opted-in module tools are callable. An older host reports that
its runtime must be updated; publication and a new host invocation provide the
capability without a worker restarting its parent.

The operator supplies `KOTA_EVAL_CONTAINED_PROFILES` as a JSON map in the trusted
host environment. A profile authorizes canonical scope roots, the existing
preset, fixture ids or AGY candidate ids, repeats, deadline, CPU and memory, and
the existing eval API's container backend. The decoder in
[contained-evaluation.ts](contained-evaluation.ts) is the configuration reference.
Request bodies select among these grants and cannot alter them.

Prepare the image with the selected adapter and KOTA's package layout, including
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
