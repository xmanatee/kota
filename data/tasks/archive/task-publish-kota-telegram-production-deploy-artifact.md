---
status: done
---
# Publish KOTA Telegram production deploy artifact

## Current Contract

The September 12 owner waiver reopens artifact implementation/setup and supported
integration validation. The legitimate staging `/status` exchange is operational
follow-up, not a builder completion gate or proof supplied by the existing smoke.
Preserve one Bot API poll owner, rollback, private secret resolution and clear
voice failure behavior. Any real staging run requires host-owned poll handoff and
an authentic chat input; do not impersonate the owner or claim production readiness
from a controlled transport response.

This contract supersedes historical blocking and operational-capture requirements.


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
- A supported isolated integration exercises the actual deploy artifact,
  supervisor/daemon launch, health, rollback and secret-input boundaries.
  A real staging-bot exchange remains explicitly unverified until observed.

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
- Retain available launch/integration evidence and distinguish it from the
  non-gating staging interaction follow-up authorized by the owner's waiver.
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
`smoke-test.sh` is the operator's reproducible daemon-health check; it does
not consume Telegram updates because the daemon-owned interactive channel is
the single Bot API update consumer.

## Historical Staging Evidence

`.kota/runs/telegram-deploy-staging/smoke.txt` captures the Docker install
path with the populated local `.env`, successful image build/container start,
and a passing `deploy/telegram-assistant/smoke-test.sh docker` retry once the
container reached healthy state. It does not capture an actual Telegram
`/status` exchange or another bot interaction performed through the staging
deployment. This smoke result did not establish a real staging exchange.


## Historical disposition (2026-09-10)

Existing Docker smoke evidence and populated deployment credential inputs are
already present. No mandatory sudo, systemd reinstall or new token is required.
The current host daemon reports Telegram channels started; the deployment
container is stopped. Host-channel readiness does not prove staging interaction.
Use deploy/telegram-assistant/install.sh --mode docker and smoke-test.sh docker
when scheduling the controlled deployment. Do not run simultaneous pollers for
the same token or drain unrelated automation just to reproduce an old install.
The remaining proof is a real /status exchange attributable to that staging
deployment, with healthy supervisor and rollback/secret-input behavior retained.
Do not synthesize an inbound owner message or expose deployment secrets.


## Retained implementation (2026-09-12)

The deployment artifact now supplies the current pnpm build inputs and native
SQLite build tooling, excludes runtime secrets/state from Docker build context,
and selects the production daemon target while retaining the explicit eval target.
Docker and systemd share configuration generation. Secret input is literal data
rather than sourced shell; unsupported/duplicate keys fail before supervisor
launch. Docker rollback no longer requires credentials and preserves state unless
purge is explicit. The systemd unit remains supported with a complete prebuilt
`/opt/kota` package and Node-compatible hardening. README inputs and rollback paths
match these changes. Existing Telegram single-poller and voice-failure behavior
is unchanged.

`deploy/telegram-assistant/integration-test.sh` supplies the actual Docker build,
installer, supervisor/daemon health, secret-boundary and rollback/purge journey
with unique resources, fake credentials and no runtime network. It has not run
successfully in this builder environment; it is not staging-bot proof.

Validation: `pnpm build`, `pnpm check:fast`, ShellCheck, Compose YAML parsing and
12 deploy-boundary tests passed. Another 59 Telegram bot/channel owner tests passed,
including missing-transcription behavior. The daemon integration test was attempted
but failed on sandbox `listen EPERM: operation not permitted 127.0.0.1` before
acceptance could be observed. Docker capability probing returned permission denied
for its socket, and the accessible CLI could not resolve `docker compose`. These
observations describe this sandbox, not host credential or host capability absence.
Run evidence: `2026-09-12T06-41-39-176Z-builder-rdgdrt`.

## Workflow preset repair

The critic identified a repairable configuration defect: selecting an OpenRouter
chat model left workflow tiers on the shipped Codex default. The entrypoint now
selects the shipped `openrouter` preset when an OpenRouter chat model has no
explicit or saved preset. Other chat providers require an explicit/saved workflow
preset. Harness selection inherits that preset unless explicitly overridden.
The README distinguishes chat model selection from workflow tier/auth selection.

All 16 deploy-boundary tests pass, including generated-config probes through the
production `resolveAgentRuntime` and `createModelClientImpl` for every workflow
tier with default and explicit OpenRouter presets. Explicit saved preset/harness
inheritance and missing-preset rejection are covered. These checks require no
Docker or live credentials and repair the critic finding independently of the
contained launch prerequisite below.

## Completed host integration (2026-09-12)

The host ran the checked-in `integration-test.sh` against the revised deploy
artifact at `db6cc65d96e20dd5c78cce5e5db789f9854ea3a9`. It passed the actual
Docker build, installer, supervised daemon health, literal/private secret input,
rollback with state retention, and explicit state purge. The container used fake
credentials, no host mounts and network mode `none`; no second real Telegram
poller was started. Container and volume cleanup completed. Transcript:
`/tmp/kota-deploy-check-20260912.log` (retained monitoring copy under .kota/runs).

An authentic staging-chat exchange remains unperformed, as the Current Contract
explicitly permits; it is not a prerequisite for this artifact's completion.
