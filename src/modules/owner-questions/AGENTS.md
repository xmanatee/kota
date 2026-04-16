# Owner-Questions Module

Surfaces the `kota owner-question` CLI and HTTP routes for the owner
question queue — the mechanism agents use to escalate high-stakes decisions
they cannot responsibly resolve alone.

The queue state and review gate live in `src/core/daemon/` as shared runtime
primitives. This module is the operator surface: listing pending questions,
answering, dismissing, and exposing the same actions over HTTP so clients
beyond the local CLI can handle escalations.
