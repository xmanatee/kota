---
status: done
---

# Security review: The Slack channel accepts every delivered message with a user and channel as authorized interactive input. Its closed configuration has no interactive-user allowlist, while slash commands and agent sessions execute without applying the inbound-signal trust classification. Any workspace user visible to the Slack app can consequently access project-backed clients or invoke the agent under the configured autonomy mode.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/slack-channel/bot.ts
claim:

> The Slack channel accepts every delivered message with a user and channel as authorized interactive input. Its closed configuration has no interactive-user allowlist, while slash commands and agent sessions execute without applying the inbound-signal trust classification. Any workspace user visible to the Slack app can consequently access project-backed clients or invoke the agent under the configured autonomy mode.

## Desired Outcome

> Add a default-deny interactive Slack user allowlist and validate the expected workspace and direct-message channel type. Apply authorization before slash commands, inbound signals, agent sessions, and interactive callbacks; keep actor trust metadata separate from admission.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T01-40-48-994Z-security-review-wz3svj.

finding id: security-review-slack-interactive-users-unauthorized
candidate id: auth-approval-boundary:src/modules/slack-channel/bot-options.ts:7
verdict: confirmed
rationale:

> The closed Slack configuration and schema contain no interactive-user allowlist or expected workspace selector (config.ts:6-12; index.ts:159-191). bot.ts:151-216 accepts any delivered non-bot message with a user and channel, runs slash commands before inbound-signal trust classification, ignores channel_type and team identity for admission, and otherwise creates a default-project AgentSession using the configured autonomy mode. Interactive callbacks are likewise admitted without actor authorization.

Evidence:

Evidence 1:

path: src/modules/slack-channel/config.ts

line: 6

excerpt:

> export type SlackChannelConfig = { botToken: string; appToken: string; notifyChannel?: string; defaultAutonomyMode?: AutonomyMode; inboundSignals?: SlackChannelInboundSignalConfig; };

Evidence 2:

path: src/modules/slack-channel/bot.ts

line: 151

excerpt:

> if (payload.type === "events_api") { const event = payload.payload.event; if (event.type === "message") { const msg = event as SlackMessageEvent; if (!msg.subtype && !msg.bot_id && msg.text && msg.user && msg.channel) { this.handleMessage(msg.user, msg.channel, msg.text, msg, payload.payload)

Evidence 3:

path: src/modules/slack-channel/bot.ts

line: 189

excerpt:

> const parsed = parseSlackSlashCommand(text); if (parsed) { await this.handleSlashCommand(channelId, parsed, userId); return; }

Evidence 4:

path: src/modules/slack-channel/bot.ts

line: 209

excerpt:

> session = this.getOrCreateSession(userId, this.options.getDefaultProjectRuntime()); session.proxy.target = transport; session.lastActive = Date.now(); await session.agent.send(text);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification on 2026-08-15:
  - `NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=true src/modules/slack-channel` — 18 files and 115 tests passed, including denial before slash commands, inbound-signal emission, sessions, and approval callbacks.
  - `pnpm typecheck` — passed.
  - `pnpm build:schema` followed by the focused `src/modules/config/config.test.ts` suite — generated schema matched the source fragment and all 22 tests passed.
