# Scope Improvement Initialization

Owns reservation of the initial guidance/policy review for an eligible hosted
scope. Onboarding completion and dispatcher reconciliation call the same
reservation decision. Existing scopes do not need fabricated lifecycle events.
Pending and consumed fingerprints suppress replay; callers publish the request
and compare-and-set state together on run success.
