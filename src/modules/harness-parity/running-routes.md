## Running a supported route

From the selected scope, use `pnpm kota harness-parity run --scenario
fix-arithmetic-bug --harness <name> --model <model> --out <artifact-directory>`.
The ordinary command passes the model verbatim: native adapters require their
native model id; ModelClient adapters require `provider/model`. Provider config
and credential resolution stay in the selected scope while edits happen in the
materialized scenario. Use separate output directories for separate invocations
so paired evidence is not overwritten. Use `harness-parity matrix --help` for
compatible model/provider selection across a harness pool.

Record unavailable routes explicitly. A worker's denied credential access or
offline network does not establish missing host login, provider outage, or model
incapability. Partial captures do not establish all-adapter parity.

Native writers invoke `kota harness-parity contained` through the existing native
invocation service. Harness-parity owns this model-matrix action; eval-harness
owns the shared host profiles, container launch/auth and offline verifier boundary.
The host profile supplies the complete cohort and explicit harnesses per model
label. Worker requests select only a profile and repeat count. Adapter facts and
credentials resolve on the module host before the shared blocking worker starts;
its serialized harness descriptions cannot execute an agent on the host.
Scenario stages use the image-local harness entrypoint and retain execution
profiles alongside ordinary parity artifacts. `verification.trustedFiles` names
immutable scorer files mounted by the offline verifier; an explicit empty list
means the verifier is entirely inline. Missing declarations reject contained
admission. Declared files and their local imports must cover the scorer, while
candidate source remains writable. Host profile and image readiness are setup
facts, not model-quality or confinement evidence.
