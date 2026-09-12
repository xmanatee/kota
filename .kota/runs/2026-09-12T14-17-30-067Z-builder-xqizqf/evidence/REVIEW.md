# Preserved AGY benchmark preparation

This directory makes the existing builder artifacts readable from the review
workspace. All 71 files copied from the run's runtime-owned agent directory
matched their original bytes. No model call, container launch, host reconfiguration
or benchmark repeat was performed during this repair.

- [Original native tool response](agy-model-routing/contained-inspect-response.json):
  tool use `tool-5ddb748d77321d5038316453cb7ec867` returned `is_error: true`
  and the missing `KOTA_EVAL_CONTAINED_PROFILES` diagnostic. Its SHA-256 is
  `55e761b622967781b37ed3cf7cdef80953e6717be18eab3bcfbf79a34648e174`.
  The critic's separate authorization denial neither verifies nor contradicts
  this earlier host response.
- [Preparation guide](agy-model-routing/setup/README.md), [image recipe](agy-model-routing/setup/Dockerfile),
  [proxy recipe](agy-model-routing/setup/Proxy.Dockerfile),
  [proxy policy](agy-model-routing/setup/squid.conf),
  [network configuration](agy-model-routing/setup/compose.json),
  [proposed host profile](agy-model-routing/setup/host-profiles.json) and
  [request](agy-model-routing/setup/request.json) are prepared inputs.
  They were not deployed. Credentials are absent from this packet.
- [Scenario definitions](agy-model-routing/scenarios.json),
  [input hashes](agy-model-routing/input-manifest.json) and the adjacent
  `inputs/` directory retain the three canonical scenarios and 51 source files.
  [Preparation validation](agy-model-routing/preparation-validation.json)
  records the production fixture/instruction/profile/request checks.
- [Compiled payload](agy-model-routing/kota-build.tar.gz) and
  [original checksum receipt](agy-model-routing/kota-build.sha256) retain the
  build input. The receipt names its original absolute runtime path; verify the
  copied archive against the same digest, using this directory's local path.
- [Build log](build.txt), [static checks](check-fast.txt),
  [owner tests](agy-model-routing/owner-tests.txt) and
  [process diagnostic](agy-model-routing/process-test-diagnostic.json) preserve
  the successful build/static gate, 15 test passes and the one
  `spawnSync /bin/ps EPERM` failure. They are historical execution records,
  not tests rerun during this copy.
- [Execution plan](agy-model-routing/execution-plan.json) and
  [routing decision](agy-model-routing/routing-decision.md) retain the zero-run,
  needs-more-data disposition. Statements in that original decision describing
  a task-only repository diff refer to the pre-repair changeset; the repair also
  adds these evidence copies.

The original packet remains under the run's runtime-owned `agent/` directory.
The repair changes only review access and task references. The host profile
grant, Linux image/proxy/auth validation and three-repeat candidate measurements
remain outstanding. No production routing change is justified.
