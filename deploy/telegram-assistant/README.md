# KOTA Telegram personal assistant — deploy artifact

One reproducible bring-up for KOTA as a Telegram-channeled personal
assistant on a Linux host. One daemon process owns both Telegram
channels, the scheduler, and every workflow. There is no second
supervised bot process.

## Inputs

Copy `.env.example` to `.env` and populate:

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Required. BotFather-issued token. |
| `TELEGRAM_ALERT_CHAT_ID` | Required. Chat id authorized for `/status` and notification events. |
| `KOTA_MODEL` | Optional but recommended. Provider/model id for chat sessions, for example `openrouter/openrouter/auto`. |
| `OPENROUTER_API_KEY` | Optional. Required when `KOTA_MODEL` starts with `openrouter/`. |
| `KOTA_DEFAULT_AGENT_HARNESS` | Optional. Defaults to `openai-tools` for OpenAI-compatible delegated agent steps. |
| `KOTA_TELEGRAM_DEFAULT_AUTONOMY_MODE` | Optional. Defaults to `supervised`. |
| `KOTA_TELEGRAM_ALLOWED_CHAT_IDS` | Optional comma-separated allowlist. Empty defaults to `TELEGRAM_ALERT_CHAT_ID`. |
| `ANTHROPIC_API_KEY` | Optional. Only needed when selecting Anthropic-backed models. |
| `OPENAI_API_KEY` | Optional. Enables OpenAI-backed models and a Whisper transcription provider for inbound voice notes. Without it, voice messages produce an explicit user-facing failure rather than a silent drop. |

For OpenRouter, set `KOTA_MODEL` to `openrouter/<OpenRouter model slug>` and
set `OPENROUTER_API_KEY`. For example, OpenRouter's `openrouter/auto` router is
`KOTA_MODEL=openrouter/openrouter/auto` in KOTA syntax: the first segment
selects KOTA's OpenRouter provider, and the remainder is the OpenRouter model
slug. The Docker entrypoint writes these deploy choices into
`/var/lib/kota/.kota/config.json`; it stores only model/config values, not raw
provider keys.

## Supervisors

| Path | Supervisor | When to pick |
|------|-----------|--------------|
| `install.sh --mode docker` | docker compose | Default on hosts with Docker. Most portable; the Dockerfile owns the Node runtime and KOTA build. |
| `install.sh --mode systemd` | system-level systemd | Hosts without Docker, or deployments that prefer native process supervision with the hardening directives in `kota-telegram.service`. Requires a prebuilt `/usr/local/bin/kota`. |

Both paths ultimately run `kota daemon` with restart-on-failure
supervision. The daemon's own in-process supervisor (see
`RESTART_EXIT_CODE`) handles graceful restarts; docker/systemd handle
hard crashes.

## Bring-up

```sh
cp deploy/telegram-assistant/.env.example deploy/telegram-assistant/.env
# edit .env with real secrets
sudo deploy/telegram-assistant/install.sh           # auto-detects docker or systemd
deploy/telegram-assistant/smoke-test.sh             # verifies daemon is reachable
# message the bot and send /status — reply confirms both channels live
```

For docker only, `sudo` is not needed if the invoking user is in the
`docker` group.

## Rollback

```sh
sudo deploy/telegram-assistant/rollback.sh           # removes the supervisor unit
sudo deploy/telegram-assistant/rollback.sh --purge-state  # also deletes /var/lib/kota or the docker volume
```

State persists across rollbacks by default (`/var/lib/kota` for
systemd; the `kota-telegram-state` docker volume for compose) so
reinstalling picks up conversation history, scheduled items, and task
queue.

## Operational notes

- Logs are structured JSON on both paths (`KOTA_DAEMON_LOG_FORMAT=json`).
  Follow with `docker logs -f kota-telegram` or `journalctl -u kota-telegram -f`.
- Health probes: docker healthcheck and `smoke-test.sh` both call
  `kota daemon status`, which exits 0 only when the daemon's control
  socket responds.
- Secrets: never bake into the image. Mount via `--env-file` (docker)
  or `/etc/kota/telegram-assistant.env` (systemd, mode `0640`, owner
  `root:kota`).
- Integration coverage for the in-process daemon + telegram channel
  path lives in `src/modules/telegram/daemon-integration.test.ts`.
  Static coverage for the deploy artifacts themselves lives in
  `deploy/telegram-assistant/deploy.test.ts`.
- An end-to-end launch against a live staging bot is the operator's
  acceptance step — it requires real Telegram credentials which are
  not committed to the repo. `smoke-test.sh` is the reproducible
  post-install check that proves the daemon reached a healthy state.
