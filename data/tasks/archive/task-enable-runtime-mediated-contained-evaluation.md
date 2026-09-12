---
status: done
---
# Make contained evaluation callable through the existing runtime action boundary

## Problem

AGY benchmark run `2026-09-12T06-40-57-819Z-builder-n2rhhp` and rollout builder
`2026-09-12T06-41-11-663Z-builder-drp743` can implement routing but cannot invoke
Docker, local inference endpoints or host-managed login from their native worker
sandbox. Host Docker access works. Repeatedly labeling this missing mediation as
an owner-capture prerequisite prevents both tasks from reaching live evaluation.

## Outcome

An authorized automation can request a bounded contained evaluation through the
existing eval module's tool/client/action boundary. The trusted runtime invokes
the existing runner and returns attributable results to the requesting run. The
coding worker and evaluated candidate remain isolated; neither receives general
host shell access, a Docker socket or raw host credentials.

Inspect existing eval client/API routes, native tool mediation and execution
authorization before changing code. Reuse their capability and lifecycle owners,
not a new queue, executor, approval system or provider-specific bridge. The recent
native-auth/local-routing work belongs to its existing owners and must not be
reimplemented here. Keep image and restricted egress setup discoverable through
the same evaluation surface; return actionable setup failures, not a vague capture request.

## Acceptance

- An authorized workflow call reaches the trusted eval runner across the native
  isolation boundary and returns results/artifacts under its originating run.
- Existing authorization constrains scope, scenario, image, network and resource
  access. Untrusted arguments cannot become arbitrary Docker commands or host mounts.
- Existing cancellation, process supervision, provider backoff and cleanup apply
  to the delegated execution. No detached, unowned or duplicate evaluation survives.
- Focused boundary checks distinguish authorized invocation, denied widening,
  cancellation and returned failure. Do not repeat every model/scenario combination.
- The implementation can publish without restarting its own parent or running
  the complete live benchmark from the coding sandbox. The host monitor verifies
  the deployed invocation; the dependent tasks own actual model measurements.

## Consumers

The AGY routing benchmark and OpenRouter/local rollout evaluation use this same
capability. They retain their model-quality and containment requirements; this
task does not mark either benchmark completed or permit changing production defaults.

## Completion

The eval module now exposes `kota eval contained` and its opted-in tool through
the existing native invocation service. Host profiles bound scope, fixtures or
AGY candidates, repeats, image, restricted egress, deadline, CPU and memory.
The existing eval runners return request/result/failure artifacts under the
originating run. Adapter-owned credentials remain on the trusted execution side.

Shared workflow execution owns cancellation, durable process/resource registration,
provider backoff, and container/auth-snapshot cleanup, including interrupted-run
recovery. The worker cannot supply host commands, mounts, credentials or profiles.
Setup and invocation guidance lives in
[the eval module](../../../src/modules/eval-harness/contained-evaluation.md).

Initial verification: static checks and client-binding consistency; 65 selected tests
cover transport, module registration, scope-policy denial, runner failure and
attribution, cancellation, cleanup/recovery, auth isolation, and maintained eval
consumers. Source and built CLI probes verify discovery and the actionable
older-host response. Production compilation and asset copying pass. Repeating
the build's clean step encountered sandbox-protected `dist` directories; real
process-execution tests cannot pass this sandbox's `/bin/ps` denial. No live
model-quality or deployed-host containment result is claimed. The host monitor
verifies deployed invocation; the dependent tasks retain actual measurements.

Detailed validation output is retained with builder run
`2026-09-12T10-21-51-566Z-builder-oveaxe`.

Critic repair preserves inherited tool allowlists, denylists and permission
callbacks through native mediation. The writer guard also checks host-updated
inputs. Restart recovery attempts each independent process/resource cleanup
instead of stopping at the first failure, while retaining unresolved ownership.
Repair verification passes 53 selected tests, `pnpm check:fast`, and production
compilation. These include eight new regression cases for inherited restrictions,
input updates, PID reuse, termination failures and independent cleanup failures.
The previously documented live-host and sandbox verification limits still apply.

Further critic repair makes normal cleanup attempt independent owners concurrently
and retain the invocation through failures until worker exit and confirmed cleanup.
Cancellation starts resource removal before worker exit, and process notifications
racing cancellation still reach durable ownership. AGY availability now awaits
asynchronous process supervision with the host cancellation signal and bounded
deadline. Temporary auth cleanup can proceed during a container-server outage.

Final repair verification passes 36 selected tests, including eight new regression
cases for cleanup failures, independent cleanup, cancellation before synchronous
child exit, registration races, and asynchronous availability. Production compilation,
runtime asset copying and the built CLI help probe pass. The maintained AGY runner
process test now encounters the same sandbox `/bin/ps` denial already documented;
its passing earlier execution does not prove the changed subprocess path. The new
availability tests control only the external subprocess port. No process identity
check was bypassed, and deployed-host and live-model follow-up remain unchanged.

Final cleanup-race repair confirms resource removal after every producer stops:
early concurrent cleanup remains available to release blocked clients, while a
second resource sweep after worker exit and client termination gates the return.
Failure of that final sweep retains ownership and retries. The regression first
reproduced a surviving resource after successful termination, then passed with the
fix; a second case covers transient final-removal failure. A SQLite recovery check
confirms its existing client-before-resource ordering, without changing recovery.

Cleanup-race verification: 25 selected tests, `pnpm check:fast`, production
compilation and changed-source whitespace validation pass. Logs are retained with
the same builder run. Previously documented sandbox and live-host limits apply.
