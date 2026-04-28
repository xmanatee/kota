# Tighten acceptance evidence for client fan-out

Source / intent: Recent commits added broad web/mobile/macOS/Telegram/Slack
fan-out. Tests are strong, but acceptance evidence often lives in unit tests
instead of rendered/operator-visible artifacts.

Desired outcome: Define a lightweight standard for client/channel fan-out
tasks: at least one rendered-output artifact, screenshot, CLI transcript, or
shared fixture per user-facing surface when the task changes visible behavior.
Keep this narrow; do not create a parallel changelog or audit surface.
