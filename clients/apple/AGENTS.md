# Apple Clients

Native macOS and iOS clients share daemon transport, domain view state, and
SwiftUI presentation while retaining thin platform shells.

- All live state and operations flow through the shared daemon client. Views do
  not scatter routes, authentication, decoding, or daemon policy.
- Local and remote discovery use one connection model. Secrets belong in
  Keychain, and a lost connection clears live state into an explicit offline
  condition.
- Consume generated bindings from the daemon-owned structural contract. Keep
  authored Swift types only for presentation/domain concepts that are not wire
  mirrors; do not copy fixture trees or decoder catalogs.
- Group daemon operations by domain capability behind the shared client and own
  one event-stream lifecycle per connection.
- The shared package does not import AppKit or UIKit. Native affordances use
  narrow protocols implemented by the macOS and iOS shells.
- Voice and other vendor-backed capabilities go through daemon operations;
  clients own only platform capture and playback.
- Add package dependencies only when a platform capability cannot be expressed
  clearly with the standard libraries or existing ports.

Verify shared domain behavior once, platform-specific behavior in its owning
shell, generated binding freshness at build time, and a small number of real
operator journeys. Do not repeat the entire daemon contract suite in every
target.
