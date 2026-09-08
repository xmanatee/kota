---
status: open
priority: p2
---

# Cover cart pricing loyalty and delivery rules

Cart pricing is correct, but the tests only exercise a small standard cart.
Extend `test/pricing.test.mjs` to protect the gold discount threshold, exclusion
of silver customers, and free delivery based on the subtotal before discounts.
Preserve source, verifier, and package files. Choose clear test names and useful
assertions; no manifest is required.

Run `node scripts/check-targeted-tests.mjs`. It runs your tests on the correct
implementation and on three defective variants. Complete the task when the
correct implementation passes and all defects are detected, then archive it.
