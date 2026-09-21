# Can a cross-service answer distinguish unavailable sources from empty results?

Research lead from explorer run `2026-09-21T13-58-22-900Z-explorer-jzbp00`;
sources read online September 21, 2026.

[PAUSE, Appendix A.1](https://arxiv.org/html/2607.27354v1)
models data availability as dependent on source connections, permissions and
requested time ranges. Feature probes expose restricted states. Its section 5.2
reports gains from explicit configuration guidance. Section 7 acknowledges
incomplete state verification for open-ended tasks and no systematic pass@k or
pass^k reporting. The [released repository](https://github.com/hyc481/PAUSE)
also reports model-performance variation with unresolved causes. These are
external observations, not evidence of a KOTA defect or a prompt recommendation.

KOTA already owns setup/reauthorization through the module setup protocol.
`src/modules/google-workspace/capability-readiness.ts` probes OAuth token
refresh, while `listing.ts` and service adapters distinguish complete,
incomplete and unavailable retrieval. The useful unresolved question is how
an assistant combines those states across sources in its answer.

Consider a request to summarize relevant mail and calendar commitments. If one
source is unavailable while the other returns a complete empty result, can the
assistant preserve the useful result, name the missing coverage, and describe
the existing setup route without claiming there are no commitments or asking
for credentials in chat? Compare that with both sources being available and
empty. First inspect existing conversational coverage; pursue a matched
consumer observation only if this distinction is not already established.
Judge answer meaning and authorized effects, not reference tool-call order.

This differs from the active relative-date retrieval investigation (query
bounds and local-day meaning), completed pagination fixes, and the archived
setup/auth protocol task. No new connector, readiness store, health integration,
benchmark runner or implementation task is proposed. A credible observation
could settle this with no change; retain this as a research question until then.
