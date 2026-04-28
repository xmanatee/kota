# Add cross-client contract drift checks

Source / intent: The 2026-04-28 review found good per-client tests, but no
single check that proves all clients agree with the daemon protocol for shared
surfaces.

Work idea:

- Add fixture payloads for key daemon responses: recall, answer,
  answer-history, capture, retract, semantic search, attention, digest, voice.
- Make web/mobile/macOS decode the same fixture corpus, or generate a report
  proving each client has coverage for every daemon response arm.
- Include negative fixtures for unknown reason/source/target values so strict
  decoding stays intentional.

Desired outcome: Client protocol drift is caught mechanically when daemon
response shapes change, not discovered by manually comparing duplicated types.
