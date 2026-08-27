---
status: dropped
---

# Enforce protected project credentials in the macOS native sandbox

## Problem

    The macOS sandbox recursively allows configured readable roots and currently denies only scope-authority token paths, leaving project-local daemon credentials, KOTA secrets, and `.env*` files readable to native harness subprocesses.

## Desired Outcome

    The generated macOS sandbox profile denies every canonical protected target and its resolved aliases while retaining normal repository and read-only Git access required by native CLI agents.

## Constraints

- Consume the shared protected-read plan instead of reimplementing project-secret discovery in the macOS profile builder.
- Ensure Seatbelt rule ordering and escaping make protected-path denial effective even when an ancestor directory is recursively allowed.
- Do not broaden write permissions, weaken authority-token denial, or route native harnesses around the sandbox.
- Use sentinel fixture credentials and prevent their values from appearing in failure diagnostics.

## Done When

- The macOS profile generator emits effective read denials for daemon-control.json, secrets.json, `.env*`, authority credentials, and resolved aliases.
- A macOS native-harness subprocess launched with the project root as cwd fails to read each protected fixture through direct and alias paths.
- The same behavioral probe successfully reads an ordinary repository file and read-only Git metadata.
- Focused profile tests cover path escaping and overlapping recursive allow roots.
- The task records the exact macOS verification command and passing probe artifact.

## Source / Intent

    Implements the macOS half of the original p1 Safety outcome after the builder exhausted repair, retaining the security review's evidence that `machine-authority-sandbox.ts` denies only authority-token paths today.

Decomposed from `task-security-review-native-cli-agents-can-read-protect` after builder run `2026-08-05T11-38-20-250Z-builder-lm91sm` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused assertions over the generated Seatbelt profile showing protected denials coexist with repository-root allowances.
- A macOS runtime transcript or test artifact showing permission-denied results for all sentinel credential paths and aliases.
- The same transcript or test artifact showing successful reads of ordinary source and Git metadata.

## Resolution

Superseded by `5b68d01af` before this decomposition was created; the parent task records the macOS deny implementation and verification evidence.
