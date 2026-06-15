---
id: task-publish-kota-telegram-production-deploy-artifact
title: Publish KOTA Telegram production deploy artifact
status: ready
priority: p3
area: ops
summary: Publish a reproducible systemd/docker deploy artifact for KOTA-as-Telegram-personal-assistant so operators can stand one up without assembling services by hand.
created_at: 2026-04-22T04:52:53.604Z
updated_at: 2026-06-15T14:45:01.290Z
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

The staging-bot proof requires a real BotFather token,
allowed chat, host supervisor, and at least one configured model-provider API
key for the selected KOTA backend. The deploy artifact supports OpenRouter via
the OpenAI-compatible harness; it no longer requires Anthropic specifically.
`smoke-test.sh` is the operator's reproducible post-install check.

## Promotion Evidence

`.kota/runs/telegram-deploy-staging/smoke.txt` now captures the Docker install
path with the populated local `.env`, successful image build/container start,
and a passing `deploy/telegram-assistant/smoke-test.sh docker` retry once the
container reached healthy state. The artifact also confirms the daemon is
reachable and the Telegram channels start in the single daemon process.
