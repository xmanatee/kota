# Research: Channels, Chat SDK, And Delivery Adapters

Explorer should examine how other systems expose live channels and chat adapters, especially Telegram, and see what KOTA might support natively, what could be wrapped, and what should simply inform the current abstractions.

Focus:
- channels as clean runtime abstractions, not special cases
- adapter compatibility for web, daemon, and long-running local processes
- compare native Telegram support with Chat SDK style wrappers

Things to look at:
- Should KOTA support a Chat SDK style adapter layer in addition to native channels?
- What is the clean boundary between daemon session/channel logic and transport-specific adapters?
- Which of these ecosystems seem easier to wrap than reimplement?

Resources:
- https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents — Vercel CLI changes aimed at agent-friendly marketplace integrations.
- https://vercel.com/blog/chat-sdk-brings-agents-to-your-users — Vercel Chat SDK framing for agent-facing chat apps.
- https://chat-sdk.dev/adapters — adapter surface for Chat SDK.
- https://chat-sdk.dev/adapters/telegram — Telegram adapter with webhook, polling, and auto-mode support.
- https://code.claude.com/docs/en/channels — Claude Code channels model for long-running sessions that receive external events.
- https://clawhub.ai/plugins/telegram-ui — Telegram UI plugin listing; relevant as another Telegram delivery model.

What Explorer should produce later:
- a grounded view of which channel and adapter ideas are worth adopting, wrapping, or just tracking
