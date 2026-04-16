# Why does every agent step declare its own retry config?

Every agent step in every workflow carries the exact same `retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 }`. That's duplicated config, not per-step tuning.

The retry executor only retries classified transient provider errors (network, timeout, 5xx, "overloaded"). Everything else — agent logic errors, unclassified SDK errors, validation failures — fails on first attempt. The classifier is substring-matching on error messages, which is fragile.

Investigate:
- Do retries actually fire in production? Check recent run logs for retry events — count them per workflow over the last N runs. If retries rarely fire, the config is theater.
- Should retry config move to a runtime default (one place) and be deleted from every step definition? Any workflow genuinely want different retry semantics?
- Is the substring-based error classifier good enough, or should it key off structured SDK error types / status codes?
- Should agent-produced errors (e.g. repair-loop failures, malformed tool calls) ever be retryable? Today they aren't. Why not?
- What's the failure mode today when an unclassified error slips through — does the step fail hard, abort the run, or something weirder?
