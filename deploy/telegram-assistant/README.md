# KOTA Telegram personal assistant — deploy artifact

One reproducible bring-up for KOTA as a Telegram-channeled personal
assistant on a Linux host. One daemon process owns both Telegram
channels, the scheduler, and every workflow. There is no second
supervised bot process.

## Inputs

Copy `.env.example` to `.env` and populate:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required. Backs the interactive session loop. |
| `TELEGRAM_BOT_TOKEN` | Required. BotFather-issued token. |
| `TELEGRAM_ALERT_CHAT_ID` | Required. Chat id authorized for `/status` and notification events. |
| `OPENAI_API_KEY` | Optional. Enables a Whisper transcription provider for inbound voice notes. Without it, voice messages produce an explicit user-facing failure rather than a silent drop. |

Autonomy mode must be set through normal KOTA config. Leave it
`supervised` unless you are hardened against autonomous writes from
chat messages.

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
