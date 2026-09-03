---
status: done
---

# Consolidate core workflow runtime verification

## Scope / Starting Points

Inventory `src/core/workflow`, workflow daemon integration, run store, resources, publications, waiting/resume, recovery, blocking operations, testing helpers, fake runtimes, and every copied lifecycle matrix.

## Required Changes

- Assign admission, state transitions, resources, waiting, integration, recovery, effects, and publication to named core owners.
- Retain one strongest observation for each distinct runtime failure and one real composition path where isolation cannot prove correctness.
- Delete copied lifecycle matrices, private phase/step-order assertions, fake-runtime variants, broad reset hooks, and source-absence checks.
- Keep protocol, durability, concurrency, crash recovery, and commit/publication boundaries explicit.

## Must Not Complete While

Any lifecycle state or helper family is unclassified, any autonomy workflow repeats the core matrix, or a shadow runtime/mega-fixture remains.

## Done When

The inventory has zero unresolved rows and private runtime refactors do not affect consumers while durable outcomes remain unchanged.

## Acceptance Evidence

Provide the lifecycle/owner/scenario/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-simplify-workflow-and-autonomy-tests`.

## Completion Evidence

### Lifecycle / owner / scenario / disposition matrix

| Lifecycle or helper family | Production owner | Strongest retained observation | Disposition |
| --- | --- | --- | --- |
| Definition and trigger admission | Workflow validators and runtime dispatch | Invalid definitions and triggers are rejected before a durable run is admitted; valid typed events enqueue once. | Retained at validator and dispatch owners. |
| Queued, running, waiting, terminal, and cancelled transitions | `RunStateDatabase` and `RunCoordinator` | Durable transition, capacity, cancellation, pause, child-wait, and restored-queue outcomes are observed through stored runs. | Retained; no workflow-local queue or state machine. |
| Logical resources and ports | `RunResourceAllocator` backed by `RunStateDatabase` | Concurrent ownership is exclusive and terminal cleanup releases the allocation. | Retained; lifecycle tests now compose the production allocator. |
| Sandbox creation, execution, and cleanup | `RunLifecycle` and `RunSandboxManager` | A writer publishes its content and commit message, clears sandbox state, and removes the workspace. | Retained as the lifecycle composition boundary. |
| Generic step execution | `executeWorkflowRun` and the production step executors | Public workflow input produces durable step outputs and terminal metadata across skip, failure, retry, and resume paths. | Retained; shared fixtures only invoke the production executor. |
| Foreach iteration | Foreach step executor | Representative scenarios observe ordered item context/results, failure policy, bounded concurrency, agent dispatch, and retry resume. | Consolidated from copied executor setup and permutation coverage into one production-executor suite. |
| Owner decision ask, wait, and consume | Owner-decision steps plus owner question and decision stores | A suspended workflow resumes from an answer and persists the selected data-only decision. | Consolidated from nine split suites into one durable journey. |
| Owner-confirmed external action | Confirmed-action step plus approval, idempotency, and dead-letter owners | An authenticated authorizing decision executes once; tampering and metadata drift are rejected; failed dispatch redrives only the effect. | Retained as a separate effect boundary, using the same production-host fixture. |
| Agent admission backoff | `AgentBackoffManager`, daemon backoff state, and workflow harness runner | A classified provider failure is persisted, aborts/denies agent admission, and prevents a second harness launch. | Replaced all in-scope copied backoff state machines with the production manager over `RunStateDatabase`. |
| Await-event suspension and resume | Await store/resume owner and run executor | Matching event, timeout, replay, and restart cases settle a wait once and resume from durable state. | Retained at the wait owner. |
| Blocking operations and child processes | Blocking-operation owner and process supervisor | Cancellation, timeout, worker failure, and recovered process identity are observed at the process boundary. | Retained; external process/clock ports remain controllable. |
| Tool effects and crash recovery | Run effect journal in `RunStateDatabase` and tool step executor | Settled effects replay without re-execution and ambiguous effects fail closed after restart. | Retained at the effect owner; lifecycle composition uses the production resource allocator. |
| Restart reconciliation | `RunLifecycle` and run restart recovery | Recoverable runs resume, irrecoverable process/effect states fail closed, and writer state needing attention is preserved. | Retained at lifecycle/recovery owners. |
| Integration validation, invariant, rebase, and publication | `IntegrationQueue` and shared integration policy | Serialized publication validates the reconciled tree and canonical head; conflicts, drift, and dirty canonical state preserve the writer for attention. | Retained at the integration owner; duplicate lifecycle rebase/phase assertions removed. |
| Run evidence and retention | `WorkflowRunStore` plus run evidence writers | Durable metadata, step artifacts, emitted events, snapshots, tags, and pruning are observable through the run store. | Retained; the store is evidence rather than queue authority. |
| Schedules, cooldowns, batches, and dead letters | Their focused workflow trigger and dead-letter owners | Timing races, grouped event flushes, supersession, and redrive are each observed once at their owning boundary. | Retained as distinct trigger/recovery failures, not copied lifecycle matrices. |
| Daemon workflow composition | Scope runtime host and runtime context | Real `RunStateDatabase` and `RunCoordinator` instances preserve multi-scope isolation and runtime lifecycle wiring. | Retained as the composition path that isolated workflow tests cannot prove. |
| Autonomy workflows | Autonomy module workflow definitions | Module tests observe semantic queue routing, task/resource binding, and domain publications while core owns execution and recovery. | Retained only for module-specific decisions; no autonomy-owned core lifecycle matrix. |
| Test support | Workflow testing fixtures | Fixtures construct typed inputs, real stores, and controlled harness/process ports, then delegate semantics to production owners. | Deleted copied owner-decision/foreach setup; replaced backoff doubles; no shadow runtime remains. |

All lifecycle and helper families in scope have an owner and disposition; there
are zero unresolved rows.

### LOC accounting

The counting categories match `scripts/count-verification-loc.py`, restricted to
`src/core/workflow/**/*.ts`. “Before” is the task's admitted `HEAD`; “after” is
the completed workspace. Generated and vendored files are absent from this
subtree.

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 179 files / 32,922 LOC | 179 files / 32,922 LOC | 0 files / 0 LOC |
| Executable tests | 117 files / 32,600 LOC | 110 files / 29,159 LOC | -7 files / -3,441 LOC |
| Authored test support | 7 files / 729 LOC | 9 files / 999 LOC | +2 files / +270 LOC |

The support increase is the production-host owner-decision fixture and the real
database-backed agent-backoff fixture. They replace repeated setup and copied
runtime semantics; neither interprets workflow or lifecycle behavior.
