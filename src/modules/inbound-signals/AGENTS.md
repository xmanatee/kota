# Inbound Signals Module

This module owns the typed daemon event contract for external platform signals
that should wake bounded workflows.

- Adapters authenticate provider traffic, normalize source/account/actor
  metadata, attach project scope, validate the payload, and emit
  `inbound.signal.received`.
- Workflows decide what the signal means: task capture or update, memory or
  knowledge capture, reply, owner-question escalation, approval posture,
  retry, audit, or explicit no-op.
- Keep provider-specific planning out of channel and webhook modules. Provider
  modules may map their native delivery into this contract, but they should not
  decide downstream automation.
- Keep this contract provider-neutral. Provider-specific fields belong inside
  the normalized action payload or in the consuming workflow's parser.
