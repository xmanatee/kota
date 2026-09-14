---
status: done
---

# Prepare project dependencies before validation and runtime activation

## Problem

An accepted dependency change can strand integration or break another running
automation because the checkout used by the consumer lacks its locked packages.
This is environment preparation, not evidence that an agent must rewrite its code.

On September 13, retained MCP builder
`2026-09-13T12-15-26-827Z-builder-inxnff` declared `ajv` 8.20.0 in its manifest
and lockfile, but integration repeatedly failed with TS2307 for
`ajv/dist/2020.js`. Its isolated validation copy passed while the actual writer
checkout had no installation. An offline frozen-lockfile install, with lifecycle
scripts disabled, made production typechecking pass without source changes.
The same-ID retry validated and integrated `b70e8e9d6`, then cleaned up safely.

After publication, canonical lacked the same package. A freshly loaded
continuation worker failed to import `json-schema-2020.ts`, interrupting builder
`2026-09-13T23-14-12-918Z-builder-9xqf3e`. The same locked install in canonical
resolved module loading. Evidence belongs in those runs' integration journal,
steps and daemon events, not copied into this task.

The supervisor then remained parked even after dependency repair: failed
activation retry compares code revisions, not repaired installation readiness.
An external operator had to permit a startup attempt through daemon-state
persistence. This task must remove that need for manual state intervention.

## Desired Outcome

Dependency-changing work can prepare its real validation environment, integrate,
and activate without relying on the external monitor or breaking sibling runs.
Use the existing repository preparation, command execution and runtime activation
owners. Respect project-specific package managers and setup policy rather than
hardcoding KOTA or pnpm into a general workflow coordinator.

- Determine the smallest project-owned preparation contract and reuse it for
  the actual writer checkout and the installation that will execute new code.
- Reconcile manifest/lockfile changes before validation, including after rebase
  and recovery. Do not repeat installation when the environment is already ready.
- Account for workers loading canonical source while older runs drain: do not
  expose a new import graph before its dependencies are usable.
- Preserve isolation, frozen resolutions, supply-chain/lifecycle-script policy
  and explicit network authority. Do not make arbitrary tool execution install
  dependencies implicitly or give agents write access to shared host packages.
- Surface preparation failures as actionable local recovery, retain useful work,
  and never turn them into provider backoff or bypass required validation.
- Permit an explicit retry after verified environment repair without requiring
  a meaningless source commit. Preserve failed-activation diagnostics and the
  automatic restart-loop guard; a service retry is not proof of readiness.

## How We Will Know

One focused integration scenario changes a locked dependency, prepares and
validates the writer, integrates against a moved head, and activates usable code
without breaking a sibling continuation. Failed preparation preserves its run
and retries through the same owner after repair. Cover the common behavior once;
avoid per-workflow copies, a second package registry, or a new recovery queue.
Publishing the fix does not depend on a future monitor visit.

## Completion

The shared integration owner now prepares the reconciled writer using trusted
project configuration, retains setup failures outside source repair, and promotes
validated dependency outputs before canonical source becomes visible to new
blocking workers. The existing publication journal recovers interrupted output
replacement. Daemon start supports an explicit readiness-verified activation retry
for repaired installations at the same revision. Project setup remains opt-in via
`workflow.preparation`; the daemon-ops guidance includes the KOTA source recipe.

Verification covered configuration trust/rejection, worker drain and cancelled
publication ordering, recovery replay, same-run setup failure/retry against a
moved head, real pnpm dependency fixtures, canonical worker imports, and activation
persistence. The KOTA readiness script passed against copied installed packages
and rejected a missing AJV dependency. Static checks and production build passed.
The enclosing sandbox denies the process identity probe (`/bin/ps`), so the
composed preparation journey controls only the subprocess port; a direct attempt
and one existing validator-output test record that environmental limitation.
Run artifacts retain command output and detailed proof scope.

Post-review repair rechecks domain acceptance synchronously at the final Git
publication effect, after staging and worker drain. Source and installed launchers
now run dependency-free startup recovery from the same SQLite integration journal
before importing the affected package graph. A fresh Node process test reproduces
missing canonical packages and verifies automatic restoration, safe replay, and
refusal to interfere with a live publisher. Copying pnpm packages is documented as
an optimization rather than proof that native build artifacts survive installation.

Startup recovery now binds journal and live-owner checks to the executing
installation, independently of command scope. Both early and live recovery
require outputs authorized by current trusted preparation policy and reject
tracked or non-ignored paths before mutation. The fresh-process recovery journey
also exercises a forged foreign-scope journal, unauthorized ignored output, and
tracked-source output; each leaves installation source intact.
