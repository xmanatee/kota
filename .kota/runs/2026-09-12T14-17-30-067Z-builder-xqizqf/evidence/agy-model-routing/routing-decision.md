# AGY routing decision: needs more data

Run: 2026-09-12T14-17-30-067Z-builder-xqizqf
Task: task-execute-agy-model-benchmark-and-document-routing-d
Source: 922e062b692e63b792ff48d53809b1b72fe4bb66

No candidate scenario executed. Retain the current production routing.
This is an incomplete benchmark disposition, not evidence against any model.

| Candidate | Planned repeats per scenario | Completed | Availability / quota | Actual model / effort | Rubric / paths / pass@3 / pass^3 |
| --- | --- | --- | --- | --- | --- |
| gemini-3.7-flash (current selected) | 3 | 0 | Unobserved | Unobserved | Unmeasured |
| gemini-3.6-flash (historical) | 3 | 0 | Unobserved | Unobserved | Unmeasured |
| gemini-3.1-pro (historical) | 3 | 0 | Unobserved | Unobserved | Unmeasured |

The live CLI request crossed the native invocation boundary. Its exact returned
error in contained-inspect-response.json identifies the missing trusted-host
KOTA_EVAL_CONTAINED_PROFILES configuration. It did not reach container preflight,
AGY model listing or candidate execution. Neither credential absence nor provider
entitlement or quota failure can be inferred.

The prepared setup packet includes a decoder-validated proposed host grant,
three-repeat request, compiled payload with SHA-256, image recipe requiring a
checksum-pinned Linux AGY binary, and an adapter-derived internal Google CONNECT
proxy configuration. Fixtures and instruction sources validated with their
production owners; 51 source/input snapshots are hashed. Recipes, resource
allocations and endpoint labels have not been deployed or measured. The observed
host AGY version is 1.2.0, and its Mach-O arm64 executable cannot be the Linux input.

Production build passed (../build.txt). Four selected eval-owner test files
yielded 15 passes and one failure (owner-tests.txt). The diagnostic using the
same availability owner returns spawnSync /bin/ps EPERM
(process-test-diagnostic.json). This verifies an execution-environment limitation,
not candidate-container correctness. No tests were altered or supervision disabled.
The deterministic passes exercise scenario scoring, CLI validation and suite
decisions; they cannot establish model adherence or container isolation.

The final pnpm check:fast passed (../check-fast.txt), including production/test
types, lint, task schema/dependency validation and generated client bindings.
Changed-task whitespace validation passed, and the compiled payload checksum
verified. These establish repository consistency and retained-input integrity;
they do not replace the missing live evaluation.

The only repository change is the target task's blocked disposition and evidence.
No source, routing, preset, host credentials, Git metadata, daemon lifecycle or
other task was changed. Runtime publication will retain these run artifacts.

Resume after the existing host lifecycle supplies the reviewed scope profile.
Finish Linux image, nested sandbox, restricted egress and real AGY auth checks
through the existing owners, then run the three scenarios three times per available
candidate. Preserve positive inference and denied unintended access evidence,
execution/source/image/resource identities, actual model/effort frames, full
traces, path reports and rubric verdicts. Missing historical models must be
supported by the real catalog response; the suite rejects a mixed unavailable
batch, so submit its observed available subset with the same profile.
Respect provider backoff and do not blindly retry quota failures.

Compare equal cohorts and report pass@3 separately from pass^3. KOTA max is an
expected Gemini high mapping, not an observed AGY max flag. No favorable ranking
or promotion is justified by the current evidence.
