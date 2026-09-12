---
status: blocked
priority: p2
---
# Security review: Qualify safe browser profile persistence

## Finding And Current State

Path validation followed by Playwright's pathname write allowed a concurrent
writer to redirect authenticated browser state outside the agent write grant.
Repeated canonical-path checks or relocatable directory handles do not fix that.

`src/modules/browser/lifecycle.ts` still rejects persistence before collecting
credentials; existing-profile loading and resource cleanup remain available.
The candidate `publishPrivateFile` in
`src/core/util/filesystem/private-files.ts` has no production browser caller.
It uses a Linux helper, protected ancestors and anonymous `O_TMPFILE` staging,
then descriptor-relative publication. It rejects unsupported platforms/layouts.
It does not promise atomic conditional updates against a racing leaf replacement.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: Authorized unprivileged Linux execution with Python 3, procfs, anonymous temporary-file support and protected ancestry for the private-file security checks.

The latest retained September 12 host receipt
(`tool-f9983c7e04a7729e42c5c10b4563a27f`, builder `pbera3`) reported unset
`KOTA_EVAL_CONTAINED_PROFILES`. This audit is on Darwin and Docker execution
was denied by the execution guard despite owner authorization. This is not a
permanent Docker prohibition; do not bypass a current denial. Host container/auth capability
was not freshly probed; no missing credential is inferred. Equivalent authorized
Linux capability can satisfy this prerequisite without a prescribed capture
file. Do not repeat unchanged inspections, change host permissions, control the
parent daemon or implement another execution bridge.

## Remaining Work And Acceptance

- Qualify the actual private-file boundary on unprivileged Linux: private
  creation/replacement with complete bytes, mode 0600 and one link; write-root
  rejection before collection; changed-leaf symlink/hardlink/replacement
  rejection without modifying sentinels; rejection of relocatable ancestry.
  Exercise the existing owning cases, adding only a demonstrated coverage gap.
- Review the protected-ancestry and anonymous-staging design against the
  original root/staging-relocation threat. Do not require an impossible
  atomic compare-and-swap guarantee the API does not offer.
- Only after that boundary is qualified, connect browser save/awaited close
  through the publisher's `collect` callback and path-free
  `context.storageState()`. Verify that composition at the real publisher.
  Preserve fail-closed behavior on unsupported systems and reliable cleanup.

September 13 private-file/browser-profile owner tests passed the available
cases; all six Linux-only private-file cases were skipped. The retained broader
repair record reports 81 passes with the same six skips. Neither establishes
successful Linux publication or a complete persistence fix. This is a real
pre-activation security prerequisite, not a deployment-observation ritual.
No source or activation changed in this audit, and no successor is needed.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T23:38:46.335Z -->
