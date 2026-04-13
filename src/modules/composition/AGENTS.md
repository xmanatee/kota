# Composition Module

Orchestration tools that let agents compose other tools: batch (parallel
sub-agents), pipe (sequential tool chaining), and map (fan-out over items).

These are opt-in conveniences, not core primitives. They were extracted from
`src/core/tools/` to shrink the core surface.
