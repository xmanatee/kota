# KOTA Telegram personal assistant

The Docker artifact builds KOTA and runs `kota daemon` as a non-root user under
Compose restart supervision. That daemon hosts Telegram status and interactive
channels, the scheduler and workflows. The interactive channel owns the only Bot
API update stream. Before deploying an existing token, arrange a host-owned poll
handoff from its current daemon. The installer does not control other daemons.

## Inputs

Use a private file containing literal `KEY=VALUE` lines (LF endings), with no
shell quoting, interpolation or `export` prefix. Blank lines and comments are
allowed; unknown and duplicate keys fail before launch. Values, including `$`,
are passed literally. Keep this file mode `0600` and outside the repository.

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Required BotFather token. |
| `TELEGRAM_ALERT_CHAT_ID` | Required integer chat id for status and alerts. |
| `KOTA_MODEL` | Model, e.g. `openrouter/openrouter/auto`. Select a provider for which credentials are populated. |
| `OPENROUTER_API_KEY` | Required for OpenRouter models. |
| `ANTHROPIC_API_KEY` | Required for Anthropic models. |
| `OPENAI_API_KEY` | Required for OpenAI models; also enables Whisper transcription. |
| `KOTA_DEFAULT_PRESET` | Workflow harness/model/effort bundle. Defaults to the shipped `openrouter` preset when `KOTA_MODEL` selects OpenRouter and no preset is saved. Otherwise required. |
| `KOTA_DEFAULT_AGENT_HARNESS` | Optional override of the preset's harness; must support its workflow tier models. |
| `KOTA_TELEGRAM_DEFAULT_AUTONOMY_MODE` | Defaults to `supervised`; also accepts `passive` and `autonomous`. |
| `KOTA_TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated integer allowlist; defaults to the alert chat. |

For OpenRouter, the first segment of `openrouter/<model slug>` selects KOTA's
provider; `openrouter/auto` is the provider's model slug. Provider secrets use
KOTA's standard environment resolver. Generated config contains model and channel
settings, never these raw credentials. Without a transcription provider, voice
messages receive an explicit failure; text and status commands remain available.

`KOTA_MODEL` selects the chat model; the preset selects workflow tier models.
The OpenRouter default supplies both an API-compatible harness and provider-qualified
workflow models. An explicit or previously saved preset is preserved; select one
whose harness, models and authentication are available on the deployment host.
For example, Anthropic deployments can select `KOTA_DEFAULT_PRESET=claude`.
An API key alone does not configure a CLI-authenticated workflow preset.

## Supervisors and bring-up

On a Linux host with Docker Engine and Compose **2.30 or newer**, from a checked
out repository and with populated secrets:

```sh
deploy/telegram-assistant/install.sh --mode docker --env-file /secure/kota-inputs
```

This builds the production image, starts the service and waits for daemon health.
No host Node installation is needed. Build inputs follow the repository's pnpm
install policy; runtime secrets and operational state are excluded from the build
context. Docker stores supplied environment values in container metadata, so
access to the Docker daemon must remain private to the operator.

The systemd path remains available on hosts with Node 22, Git, and a complete
prebuilt KOTA package installed under `/opt/kota` (including `bin`, `dist`,
`package.json` and Linux-compatible `node_modules`). Copying only `kota.mjs` is
insufficient. The installer checks that package before changing service state:

```sh
sudo deploy/telegram-assistant/install.sh --mode systemd --env-file /secure/kota-inputs
```

It creates the dedicated `kota` user, installs the shared configuration entrypoint,
encodes literal secrets into a private systemd EnvironmentFile (`root:kota`,
`0640`) and starts the system service. Both paths use `/var/lib/kota` for state.
With no explicit mode, installation prefers Docker when present.

## Health and rollback

```sh
deploy/telegram-assistant/smoke-test.sh docker
# or: deploy/telegram-assistant/smoke-test.sh systemd
deploy/telegram-assistant/rollback.sh --mode docker
# or: sudo deploy/telegram-assistant/rollback.sh --mode systemd
```

Rollback stops/uninstalls supervision and preserves state. Docker rollback works
after removal or rotation of the secrets file. Add `--purge-state` only to delete
the Docker volume or `/var/lib/kota`. The systemd package under `/opt/kota` remains
installed. To revert code, reinstall the desired repository revision/package;
state/schema compatibility must be assessed before downgrading.

Docker keeps the `kota-telegram` container and `kota-telegram-state` volume names.
For independent deployments using different tokens, export a distinct
`KOTA_TELEGRAM_INSTANCE` and reuse it for install, health and rollback. Logs:
`docker logs -f kota-telegram` or `journalctl -u kota-telegram -f`.

## Verification

`src/modules/telegram/deploy-artifact.test.ts` exercises input rejection, literal
secret handling, configuration permissions, daemon argument forwarding and
supervisor failure/rollback commands through a controlled subprocess port. It
does not simulate a successful Docker launch. Telegram's owner tests cover the
single poll owner and missing-transcription reply.

A host-owned isolated execution can run:

```sh
deploy/telegram-assistant/integration-test.sh
```

This uses the actual Dockerfile, installer, Compose supervisor, daemon health and
rollback. It uses a unique container/volume, fake credential values, no host
mounts and no runtime networking. It checks secret propagation/config privacy,
state preservation and explicit purge. It records selected container provenance
without exposing environment values and cleans up its state on exit. Image builds
still need dependency download access. Do not give an untrusted candidate access
to the host Docker socket; use the runtime's contained execution authority.

A passing health check establishes daemon reachability. The isolated check does
not establish Telegram transport readiness or a real staging-bot exchange. That
exchange remains operational follow-up: after a host-owned poll handoff, an
authentic chat sends `/status` and retains the reply with deployment provenance.
