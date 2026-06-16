---
id: task-fix-telegram-interactive-model-provider-and-poller-ownership
title: Fix Telegram interactive model provider and poller ownership
status: backlog
priority: p1
area: channel
summary: Make Telegram interactive chat fail clearly or route through a valid harness/provider when the active preset is Codex-only, and add deterministic single-poller diagnostics for Bot API getUpdates conflicts.
created_at: 2026-06-16T00:25:21.300Z
updated_at: 2026-06-16T00:25:21.300Z
task_class: Product
---

## Problem

Messaging the configured Telegram bot currently reaches the daemon but fails
after update intake:

```
[kota-telegram] Error in chat 136296712: Model provider is not configured for "gpt-5.5". Use provider/model notation (for example "openrouter/openrouter/auto" or "openai/gpt-5.5") or set modelProvider.type.
[kota-telegram] Poll error: Telegram API getUpdates: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
```

The first error means Telegram can receive the text update, resolve project
scope, and attempt to start an interactive `AgentSession`, but that session
constructs a native `ModelClient` from the active model. The project config has
no `modelProvider`, and the shipped default preset is `codex` with bare model
id `gpt-5.5`. Workflow agent steps can use that model through the Codex CLI
harness, but Telegram interactive sessions currently use `AgentSession`'s
ModelClient path, where bare `gpt-5.5` is invalid unless a provider is set or
the model is written as provider/model notation.

The second error means the Telegram Bot API sees more than one active
`getUpdates` consumer for the same bot token. Current production channel code
intends `telegram-interactive` to own the only long-poll loop, and
`telegram-status` is tested not to poll. However, the runtime still reports Bot
API conflicts and the repo still contains older status/callback poll helpers,
so KOTA needs deterministic ownership checks and diagnostics rather than
leaving the operator to infer which process or helper owns the stream.

## Desired Outcome

Telegram should be trustworthy as an operator channel:

- If interactive Telegram chat is enabled with a Codex-only preset and no
  `modelProvider`, startup or first-message handling must fail with a clear
  setup requirement explaining that Telegram chat needs either a ModelClient
  provider or an explicit supported harness path.
- If Telegram chat should support the Codex preset, it must route through the
  same harness/preset resolution used by workflow agent steps instead of
  attempting to create a native provider client from bare `gpt-5.5`.
- The daemon must expose one authoritative Telegram polling owner per bot
  token and must not start `status-poll`, `callback-poll`, or duplicate
  `TelegramBot` loops beside the interactive bot.
- Repeated Bot API `getUpdates` conflicts must become a typed runtime warning
  or operator inbox/setup item with evidence and next action, not only noisy
  terminal output.

## Root Cause Evidence

- `.kota/config.json` configures `modules.telegram.allowedChatIds` and
  `modules.telegram.defaultAutonomyMode`, but no `modelProvider`.
- `src/core/model/preset.ts` sets the shipped `codex` preset default model and
  capable tier to bare `gpt-5.5`.
- `src/modules/telegram/index.ts` passes `ctx.config.model` and
  `ctx.config` into `new TelegramBot(...)`.
- `src/modules/telegram/bot.ts` creates `new AgentSession(loopOpts)` with
  `model: this.options.model ?? this.options.config?.model`.
- `src/core/loop/loop-constructor.ts` falls back to
  `resolveActivePresetFromConfig(options.config).defaultModel`, then calls
  `createModelClient({ model: state.model, provider:
  options.config?.modelProvider?.type, ... })` when no client is injected.
- `src/modules/model-clients/factory.ts` intentionally throws when a model has
  no provider prefix and no configured provider.
- `src/modules/telegram/bot.ts` polls with
  `allowed_updates: ["message", "callback_query"]`; `src/modules/telegram`
  also still contains standalone `status-poll` and `callback-poll` helpers
  whose comments warn that a second long poll cancels the older one.
- Local process inspection during the incident showed one visible KOTA daemon
  process, so the duplicate poller may be an internal duplicate start, an
  older helper path, or an external process using the same token. KOTA should
  diagnose and surface that distinction.

## Constraints

- Do not solve this by silently forcing `modelProvider.type = openai` or by
  requiring the operator to provide `OPENAI_API_KEY`. The operator explicitly
  does not want to give OpenAI or Anthropic API keys until KOTA is trusted.
- Preserve existing workflow-agent Codex CLI behavior; workflow steps using
  `codex/gpt-5.5` or bare preset-owned Codex ids must not regress.
- Preserve Telegram slash commands, `/status`, owner-question replies,
  approval callbacks, project binding, voice-transcription failure messaging,
  and notification forwarding.
- Do not create multiple independent Telegram poll loops. One bot token has one
  update stream owner inside a daemon process.
- Do not log bot tokens, chat text, API keys, or browser/session credentials in
  diagnostics, fixtures, inbox items, or rendered evidence.

## Done When

- Telegram startup/readiness distinguishes "bot credentials present" from
  "interactive model backend usable" and surfaces a setup requirement when the
  latter is false.
- Telegram interactive first-message handling no longer throws the generic
  `Model provider is not configured for "gpt-5.5"` error to terminal.
- Either Telegram interactive chat supports Codex-preset execution through a
  valid harness/client path, or it blocks itself with an operator-readable
  setup message before creating an unusable session.
- Only one production Telegram `getUpdates` loop can be started for a bot token
  inside a daemon, and duplicate starts are rejected or reported with owner and
  source context.
- Repeated Telegram Bot API conflict responses create one deduped runtime
  warning/inbox or setup item describing the likely duplicate-consumer cause
  and safe next action.
- Legacy standalone polling helpers are either removed, demoted to test-only
  helpers, or wrapped so they cannot be started in daemon production paths.

## Source / Intent

Owner reported the live daemon after messaging the Telegram bot on
2026-06-16. The visible terminal output showed both a Telegram chat model
provider failure for bare `gpt-5.5` and a Bot API `getUpdates` conflict.

This is a P1 Product task because the operator channel appears configured but
cannot answer messages, and the daemon does not clearly tell the operator
whether the problem is provider setup, duplicate polling ownership, or both.

## Initiative

Operator channel trust: Telegram should be a reliable daemon-backed control
surface with explicit setup readiness, one update-stream owner, and clear
operator-visible diagnostics when external Bot API or model-provider contracts
are not satisfied.

## Acceptance Evidence

- Focused Telegram test or fixture showing a config with Telegram credentials,
  `defaultPreset: codex` or implicit Codex default, and no `modelProvider`
  produces a clear setup/readiness failure instead of the raw provider factory
  exception.
- Focused Telegram test or fixture showing a valid provider/model config still
  creates a working interactive session and preserves `/status`, callbacks,
  project routing, and ordinary message handling.
- Polling ownership test proving `telegram-status`, callback handling, and the
  interactive bot do not start competing production `getUpdates` loops for the
  same bot token.
- Runtime-health or module-log fixture showing repeated Bot API conflict
  messages produce exactly one deduped operator-visible warning or setup item.
- Redacted Telegram rendered-message fixture or daemon transcript proving the
  operator sees an actionable setup message instead of a terminal-only failure.
