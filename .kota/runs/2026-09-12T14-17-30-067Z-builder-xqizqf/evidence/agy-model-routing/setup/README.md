# Prepared AGY benchmark inputs

These inputs are prepared, not deployed. The live native mediation request
`tool-5ddb748d77321d5038316453cb7ec867` reached the trusted host and was rejected
because KOTA_EVAL_CONTAINED_PROFILES is absent. The worker cannot configure that
host-owned grant. This is not evidence of missing host Docker, credentials,
entitlement, quota or candidate availability.

The adjacent payload tarball contains the compiled current KOTA package, lockfile
and dependency policy. Extract it into a clean build directory and copy Dockerfile
there. Supply an official Linux AGY binary for the Docker target architecture as
agy-linux, record its download provenance and SHA-256, and pass AGY_SHA256 to
docker build. The observed host AGY is 1.2.0 / Mach-O arm64, unsuitable for COPY
into Linux. No vendor Linux binary has been acquired in this invocation.
The recipe installs Linux dependencies under the repository's pnpm policy; it
never copies host node_modules or host login state. Resolve/retain actual base
image digests and the resulting image ID with build logs before measuring.

The proxy recipe uses Squid's existing CONNECT enforcement. compose.json gives it
a dedicated outgoing network and the labelled internal candidate network, with no
published host ports. squid.conf is generated from the adapter's exact Google
endpoint catalog, permits CONNECT on 443 only, and denies private/link-local
destinations before allowing provider hosts. Build/deploy through the host's
existing container lifecycle. Candidate containers must join only the internal
network through the eval runner; the proxy does not receive candidate data mounts.
Labels and configuration are intent, not observed network isolation.

host-profiles.json is a decoder-validated proposed grant for this scope: three
Gemini candidates, the canonical three-scenario suite, three repeats, 2 CPU,
4096 MB, and a six-hour request deadline. These are proposed resource allocations,
not observed capacity or throughput. The host operator binds this reviewed grant
to KOTA_EVAL_CONTAINED_PROFILES through its existing lifecycle; this worker must
not restart its parent or set a worker environment variable as a substitute.
Pin the built image by digest in the grant before launch. Coordinate the shared
image and login/egress owners with the existing rollout evaluation task.

Before measuring, verify Node environment-proxy support, native nested sandbox
creation under the runner's actual flags, Linux AGY auth via the adapter's
declared provider-auth owner, positive provider inference and negative direct
internet/private-host/credential access. The macOS keychain is not a Linux login
source. Never copy that keychain, raw credentials, or the Docker socket into the
candidate tree. This packet does not claim environment variables alone establish
AGY authentication or terminal credential isolation.

Invoke the existing native surface with request.json after inspect shows the
authorized profile. Keep its runtime-owned returned artifacts and source/image
identity. If historical rows are unavailable, retain the real catalog response
and evaluate available rows with the same profile and repeats. The current
suite rejects a batch containing any missing candidate before candidate launch;
select the observed available subset, without substituting models. Stop for
classified quota/provider incidents rather than blindly retrying.

Inspect real model/effort frames, scenario traces, changes, rubric verdicts,
resource comparability, pass@3 and pass^3. KOTA max maps to Gemini high; it is
not an observed max AGY flag. Intrinsic models outside this requested cohort
must omit unsupported flags. A needs-more-data or rejected decision is valid.
No production preset change is authorized or made by this packet.

