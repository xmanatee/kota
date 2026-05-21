---
id: task-publish-kota-telegram-production-deploy-artifact
title: Publish KOTA Telegram production deploy artifact
status: blocked
priority: p3
area: ops
summary: Publish a reproducible systemd/docker deploy artifact for KOTA-as-Telegram-personal-assistant so operators can stand one up without assembling services by hand.
created_at: 2026-04-22T04:52:53.604Z
updated_at: 2026-05-07T12:27:35.000Z
---

## Problem

`src/modules/telegram/AGENTS.md` documents the env vars, autonomy mode,
and module combination needed to run KOTA as a Telegram-channeled
personal assistant. Operators still have to assemble process
supervision (systemd unit, docker-compose file, launchd plist, etc.)
by hand.

## Desired Outcome

A reproducible deploy artifact lives in the repo (or is published from
it) that stands up KOTA-as-Telegram-personal-assistant on a Linux host
from one command. Secrets come from the standard secrets surface; the
artifact does not ship credentials.

## Constraints

- Infrastructure-as-code: shell script, docker-compose, systemd unit,
  or similar. No manual step-by-step runbook.
- Credentials via environment/secrets, never checked in.
- The artifact runs `kota daemon` under a supervisor. The daemon hosts
  the telegram-status and telegram-interactive channels alongside the
  scheduler and workflows in one process; there is no second bot
  process.
- The artifact must degrade gracefully when `transcription` is not
  configured; voice messages should still produce a clear user-facing
  failure.

## Done When

- A deploy artifact in the repo lets an operator bring up a KOTA
  Telegram personal assistant on a fresh Linux host with a single
  command plus populated secrets.
- A README or `AGENTS.md` section describes the artifact's inputs,
  what supervisor it targets, and how to roll back.
- A live-run or integration artifact under `.kota/runs/` records at
  least one end-to-end launch against a staging bot.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/telegram-deploy-staging
description: staging-bot launch artifact — operator populates deploy/telegram-assistant/.env, runs `sudo deploy/telegram-assistant/install.sh` then `deploy/telegram-assistant/smoke-test.sh > .kota/runs/telegram-deploy-staging/smoke.txt` against a real bot token
```

## Source / Intent

Owner direction asked for KOTA to run like a real personal assistant on a
server, including Telegram and scheduled/channel-driven workflows. This task
keeps the deployment proof visible instead of letting a local implementation
count as production readiness.

## Initiative

Deployable personal assistant runtime: KOTA should run under a normal
supervisor with channel modules, daemon workflows, and secrets wired in a
repeatable operator flow.

## Acceptance Evidence

- Static tests and deploy artifact checks prove the artifact is internally
  consistent.
- A `.kota/runs/` launch artifact from a staging bot records the final
  end-to-end proof before this blocked task can move to done.
- Rollback and secret-input behavior are documented in the deploy artifact or
  nearest module instructions.

## Status

Core artifact landed in `deploy/telegram-assistant/` (Dockerfile,
docker-compose.yml, system-level systemd unit, install.sh, rollback.sh,
smoke-test.sh, README.md, .env.example), guarded by
`src/modules/telegram/deploy-artifact.test.ts`. The `src/modules/telegram/AGENTS.md`
operator-deployment section points at the artifact. Verification in
`.kota/runs/2026-04-22T17-07-32-333Z-builder-2x05jt/deploy-verification.md`
records docker-compose parse, shellcheck, and the new static test, and
reuses `daemon-integration.test.ts` as the in-process integration
artifact.

Remaining block: "against a staging bot" requires real BotFather and
Anthropic credentials that autonomy cannot populate. `smoke-test.sh` is
the operator's reproducible post-install check; once an operator runs
`install.sh` against a real bot token and captures the `smoke-test.sh`
output under `.kota/runs/`, the last Done-When item resolves and the
task can move to `done`.

## Status (2026-05-07 blocker audit)

The repository artifact is already present. The remaining block is the live
staging-bot launch proof, which requires real credentials and host-level
supervisor setup. This task should not keep spawning autonomous deploy-artifact
work; blocked-promoter should re-instruct the capture after the 14-day cadence
until `.kota/runs/telegram-deploy-staging/` exists.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-05-21T12:40:49.403Z -->
