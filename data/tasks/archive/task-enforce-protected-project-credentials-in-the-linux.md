---
status: dropped
---

# Enforce protected project credentials in the Linux native sandbox

## Problem

    The Linux native sandbox masks existing authority-token paths but recursively exposes the workflow cwd, so daemon credentials, KOTA secrets, `.env*` files, and path aliases remain visible inside the sandbox.

## Desired Outcome

    Linux sandbox construction masks or denies every protected target and resolved alias from the shared plan, fails closed when a required mask cannot be installed, and preserves ordinary repository and read-only Git access.

## Constraints

- Consume the shared protected-read plan instead of creating Linux-only protected-path semantics.
- Install masks without opening protected file contents and preserve safe behavior for files, directories, symlinks, missing optional paths, and duplicate targets.
- Do not weaken bubblewrap or equivalent namespace isolation, authority-token masking, write restrictions, or injection-defense controls.
- Do not silently launch an agent with an incomplete required mask.
- Use sentinel fixtures and keep credential values out of command arguments, diagnostics, and snapshots.

## Done When

- Linux sandbox arguments or setup operations mask daemon-control.json, secrets.json, `.env*`, authority credentials, and resolved aliases before the native process starts.
- Focused tests verify deterministic masking, correct handling of aliases and target types, and fail-closed behavior for mask setup errors.
- A Linux-capable native-harness probe fails to read every protected sentinel through direct and alias paths from a project-root cwd.
- The same probe successfully reads an ordinary repository file and read-only Git metadata.
- The task records the exact Linux verification command and passing probe or CI artifact.

## Source / Intent

    Implements the Linux half of the original p1 Safety outcome after the builder exhausted repair, retaining the security review's evidence that Linux currently masks only scope-authority token paths.

Decomposed from `task-security-review-native-cli-agents-can-read-protect` after builder run `2026-08-05T11-38-20-250Z-builder-lm91sm` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused sandbox-construction test output showing complete, deduplicated masks and fail-closed error handling.
- A Linux runtime or CI artifact showing protected sentinel paths and aliases are unreadable.
- The same runtime or CI artifact showing ordinary repository content and Git metadata remain readable.

## Resolution

Superseded by `5b68d01af` before this decomposition was created; the parent task records the Linux mask implementation and verification evidence.
