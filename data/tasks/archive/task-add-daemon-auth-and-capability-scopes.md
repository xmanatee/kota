---
status: done
---

# Add daemon auth and capability scopes for clients

## Problem

A real daemon control plane needs a security model. Today the architecture
implicitly trusts local process/file access, which is not a sufficient protocol
once multiple clients and possible remote access exist.

## Desired Outcome

Clients authenticate to the daemon and are granted explicit capability scopes
for the actions they can perform.

## Constraints

- Keep loopback-local development simple.
- Do not bolt on a second auth model for each client type.
- Capability scopes should map to real daemon actions such as status, session
  access, workflow control, and operator-only mutation.

## Done When

- The daemon/client boundary has one documented auth model.
- Clients do not rely on ambient filesystem access for control.
- Capability scopes exist for major control categories.
- Non-loopback exposure is not treated as implicitly trusted.
