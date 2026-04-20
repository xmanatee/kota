# Injection-Defense Module

Input-side defense for externally ingested content on autonomous runs.

- Registers tool middleware at priority 40 (after retry, before custom user middleware).
- Screens output of content-ingest tools against a cheap structural detector;
  suspicious payloads receive a warning banner that names the reasons and wraps
  the original content between `--- BEGIN UNTRUSTED CONTENT ---` / `--- END UNTRUSTED CONTENT ---` markers.
- Emits `injection.defense.assessed` for every screened call (suspicious or not) so
  operators can audit both missed attacks and false-positive rate via the event bus
  and run artifacts.
- Default policy: screen on `autonomous` mode only; annotate rather than drop.
- Tool-risk gating and the approval queue still apply on top — the defense does
  not downgrade any existing guardrail.
- No test-only bypass flag. Tests drive the middleware through the normal
  `ToolCall` context and assert on the banner + emitted assessment.
