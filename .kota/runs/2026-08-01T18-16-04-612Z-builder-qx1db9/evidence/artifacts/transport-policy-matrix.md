# Outbound HTTP transport policy matrix

All profiles use the same transport implementation for caller aborts, bounded
timeouts, eager response-size enforcement, manual redirects, redacted
telemetry, typed failures, and retry eligibility. Callers select a closed
profile value; there are no policy-disable booleans.

| Profile | Allowed targets | Header forwarding and redirects | Limits (default / maximum) | Retry eligibility | Current owner / call-site status |
| --- | --- | --- | --- | --- | --- |
| `public-untrusted` | HTTP(S) targets whose complete DNS result is public. Literal and resolved loopback/private ranges are rejected, and the connection lookup re-resolves and pins a validated address. | Up to 20 redirects. Cross-origin redirects keep only Accept, Accept-Language, and User-Agent and reject body or state-changing-method replay. | 30 s / 120 s; 1 MiB / 10 MiB | Idempotent methods, or writes carrying an idempotency key, on transient response/network/timeout outcomes. | `web-access` web fetch, HTTP request, and DuckDuckGo search. |
| `configured-provider` | Origins selected when the profile is constructed. | Up to 5 redirects, each revalidated against the selected origins. Cross-origin caller headers are stripped and body/state-changing replay is rejected. | 30 s / 120 s; 10 MB / 50 MB | Same centralized rule. | Brave Search today; other provider adapters are assigned to the dependent integration-migration task. |
| `oauth-protected-resource` | OAuth resource origins selected from validated protocol metadata. | Up to 5 redirects, each revalidated against selected resource origins; cross-origin caller headers are stripped. | 30 s / 120 s; 1 MB / 10 MB | Same centralized rule. | Typed foundation for core MCP/OAuth protected-resource adapters in the dependent migration task. |
| `daemon-loopback` | Loopback-only HTTP(S) hostnames or literals. | Redirects disabled. | 5 s / 30 s; 10 MB / 50 MB | Same centralized rule. | Core daemon-control health probe. |
| `explicit-callback` | Exact callback URLs selected when the profile is constructed, including path and query. | Redirects disabled. | 15 s / 60 s; 1 MB / 10 MB | Same centralized rule. | Typed foundation for webhook/callback adapters in the dependent migration task. |

Owner boundary: `src/core/outbound-http/`. Protocol-specific payload and
response semantics remain in their core or module adapters. Agent-facing
static web access remains in `src/modules/web-access/`, and rendered browser
automation remains owned by `browser`.
