# Manifest

This directory contains manifest-defined execution, validation, persistence, and step handling for agent-authored modules.

- Manifest modules provide a declarative way for agents to create persistent custom tools via JSON (`module_factory`).
- The manifest format supports `tools`, `name`, `version`, `description`, and `dependencies`.
- Automation belongs in contributed workflows and tools, not in the manifest format.
- If a capability belongs to the shared step language or workflow runtime instead, move it there instead of duplicating semantics.
