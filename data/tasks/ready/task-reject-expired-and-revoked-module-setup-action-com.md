---
id: task-reject-expired-and-revoked-module-setup-action-com
title: Reject expired and revoked module setup action completions
status: ready
priority: p1
area: modules
summary: Harden the setup/auth action lifecycle so URL/OAuth completion cannot write config or secrets after an action expires or is revoked.
created_at: 2026-06-04T13:06:27.522Z
updated_at: 2026-06-04T13:06:27.522Z
---

## Problem

`ModuleSetupService.complete()` looks up a pending setup action by id and then
immediately applies submitted config and secret values. It does not verify that
the action is still `pending`, nor that `expiresAt` is still in the future:

- `src/core/modules/setup-requirements.ts:598-634`

The existing tests cover normal completion, expired status reporting, and
revocation status, but they do not prove that an expired or revoked action id
cannot later be completed. For URL/OAuth setup, that leaves a stale action
capable of writing config or credentials after the lifecycle says it is no
longer valid.

## Desired Outcome

Harden the setup action lifecycle so only a currently pending, unexpired action
can be completed. Expired, revoked, completed, unknown, and malformed action
states should produce typed failure results and must not write config or secret
values.

The lifecycle should be enforced in the core setup protocol, not only in a
client. Every client and daemon route should inherit the same behavior.

## Constraints

- Do not expose raw secret values in errors, status JSON, tests, transcripts, or
  logs.
- Do not rely on prompt instructions or client-side checks for this boundary.
- Keep URL/OAuth setup action persistence strict and auditable.
- Preserve normal form setup and secret storage paths for valid active actions.

## Done When

- `complete()` rejects expired, revoked, and already-completed actions before
  calling `submitForm` or `storeSecret`.
- Focused tests prove no config file or secret store write happens for expired
  and revoked action ids.
- Daemon setup-control route tests still pass through the same typed failure
  shape.
- `pnpm run typecheck` and focused setup tests pass.

## Source / Intent

Architecture/security re-review on 2026-06-04. The owner asked for a careful
check of the new module setup/auth protocol, especially credential lifecycle,
storage, refresh, access, and client support.

## Initiative

Protocolized setup and credential lifecycle.

## Acceptance Evidence

- Focused test output for `src/core/modules/setup-requirements.test.ts` covering
  expired and revoked completion rejection.
- If daemon route behavior changes, focused output for
  `src/core/daemon/daemon-control.test.ts`.
