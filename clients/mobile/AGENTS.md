# Mobile Client

React Native client for shared mobile behavior and Android parity. Native iOS
behavior remains owned by `clients/apple/` unless that product boundary is
explicitly changed.

- All live state and operations flow through the shared daemon client; screens
  do not parse `.kota/`, build route payloads, or contain domain policy.
- Connection setup, authentication, decoding, and error normalization have one
  owner. Secrets use the OS secure store.
- Consume generated daemon bindings and group operations by domain capability.
  Do not copy conformance decoders, fixture catalogs, or source files into the
  mobile tree.
- Maintain one connection-level event stream and project events into view
  state. Use centralized polling only where the platform requires it.
- Navigation and push deep links consume typed daemon payloads. Test navigation
  outcomes at the reducer/router boundary rather than freezing payload tables.
- Platform-specific capture, playback, notifications, and secure storage stay
  behind narrow native ports. Vendor model or speech SDKs do not belong in the
  client.

When a feature exposes a missing API capability, change the owning daemon
contract and the client together. Keep the screen thin and verify the operator
journey plus any distinct domain decision.
