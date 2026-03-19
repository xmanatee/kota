# Modules

This directory contains built-in modules and module-level wiring.

- Keep built-in modules isolated behind module contracts rather than reaching into core internals ad hoc.
- If module boundaries drift, fix the boundary instead of normalizing the drift.
