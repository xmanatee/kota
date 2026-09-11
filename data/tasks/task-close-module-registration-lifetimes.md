---
status: open
priority: p1
---

# End module registration authority when its activation ends

## Confirmed failure

Reproduced with the real `ModuleLoader` and middleware registry on main
`0fa8700c8`, September 11, 2026:

1. Bind an event bus and load a module whose `onLoad(ctx)` retains its context.
2. Await `loader.unload(name)`.
3. Call the retained `ctx.registerMiddleware("late-after-unload", middleware)`.
4. The middleware is registered. It remains in `getToolMiddleware().list()`
   after `loader.unloadAll()`.

The same leak occurs after `onLoad` retains the context and then throws: a
subsequent registration survives shutdown of the rejected loader.

`module-loader.ts` captures a module label in registration callbacks.
`module-loader-state.ts` recreates a disposer list for that label even after
withdrawal. Exact disposers and serialized lifecycle mutations clean up past
registrations, but do not revoke future contribution authority held by stale
contexts. A delayed callback can therefore outlive its activation.

## Required outcome

Tie registration authority to the exact activation lifetime. Close admission
before asynchronous disposal and on failed admission; a retained context must
not register into an unloaded module or a later activation with the same name.
Extend the loader's existing ownership rather than adding a background sweeper,
global reset or lifecycle coordinator.

Inspect all contribution entry points in `module-context.ts`, including groups,
middleware, dynamic state, pre-send/cleanup/harness hooks, providers and event
subscriptions. Guard before publishing side effects; merely refusing to track
an already-registered disposer still leaks it. Preserve legitimate cleanup and
the documented behavior of already-running calls.

## Acceptance

- The unloaded-context and rejected-load reproductions cannot publish a live
  contribution, including after final shutdown.
- A delayed old context cannot alter a replacement activation with the same
  name; closing one activation preserves another host's owned contributions.
- Exercise the asynchronous-disposal window and failure rollback through the
  real loader. Registration rejection leaves no registry or listener residue.
- Keep a small lifecycle-owner proof covering the shared admission mechanism;
  avoid copying lifecycle matrices into every contributing module.

This is a correctness repair, independent of
`task-simplify-module-composition-tests` and its verification migration dependency.
