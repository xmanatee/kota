---
id: task-publish-kota-telegram-production-deploy-artifact
title: Publish KOTA Telegram production deploy artifact
status: backlog
priority: p3
area: ops
summary: Publish a reproducible systemd/docker deploy artifact for KOTA-as-Telegram-personal-assistant so operators can stand one up without assembling services by hand.
created_at: 2026-04-22T04:52:53.604Z
updated_at: 2026-04-22T04:52:53.604Z
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

