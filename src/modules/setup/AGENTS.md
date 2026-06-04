# Setup Module

Owns the `setup` `KotaClient` namespace and operator CLI for module setup/auth
requirements.

- Core owns the setup requirement protocol, validation, persistence boundary,
  and daemon-control routes.
- This module owns only client wrappers and CLI rendering for that protocol.
- Never print, log, or return raw credential values. Secret setup commands may
  accept values through stdin or route bodies, but output only names, states,
  and opaque action ids.
