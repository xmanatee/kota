---
id: task-add-pnpm-supply-chain-hardening-for-dependency-installs
title: Add pnpm supply-chain hardening for dependency installs
status: done
priority: p2
area: architecture
summary: Configure repo-level pnpm supply-chain safeguards and validation so dependency installs delay fresh packages, reject trust regressions or exotic transitive sources, and keep exceptions explicit.
created_at: 2026-05-18T01:51:30Z
updated_at: 2026-05-18T02:09:40.063Z
---

## Problem

KOTA pins `pnpm@10.32.1` and commits `pnpm-lock.yaml`, but dependency install
policy still relies mostly on lockfile discipline and operator judgment. The
repo has no project-level pnpm config that delays newly published packages,
blocks exotic transitive dependency sources, enforces trust-regression checks,
or records any intentional exceptions.

That leaves a gap at the package-manager boundary. Autonomous and operator-run
workflows can legitimately add or update dependencies, and a fresh compromised
npm release can be installed before registry, vendor, or ecosystem detection
has caught up.

## Desired Outcome

Dependency installation in this repo has one explicit pnpm policy surface that
reduces common npm supply-chain exposure without adding a second scanner or
governance system. The policy should make the current package-manager behavior
auditable for builders and operators:

- delay installation of newly published package versions by a chosen maturity
  window,
- block exotic transitive dependency sources unless an explicit exception is
  justified,
- enable pnpm trust-regression checks when they work with the pinned pnpm
  version and current dependency graph,
- keep build-script and trust-policy exceptions narrow, named, and tied to the
  current lockfile, and
- fail or warn clearly when the pinned pnpm version no longer supports the
  configured safeguards.

## Constraints

- Use `pnpm` and the repo's existing package-manager boundary. Do not introduce
  npm, yarn, a separate dependency scanner, or an update bot as part of this
  task.
- Prefer a single repo-level pnpm config surface, such as
  `pnpm-workspace.yaml`, unless local testing shows a better canonical file for
  these settings.
- Do not churn dependencies or rewrite the lockfile unless testing proves a
  policy exception requires it.
- Do not add broad permanent bypasses. Every `minimumReleaseAgeExclude`,
  `trustPolicyExclude`, `ignoredBuiltDependencies`, or build allowance must
  name why it exists.
- Keep docs minimal. A high-level local note is enough if the policy choice is
  otherwise obvious from config and tests.

## Done When

- Repo-level pnpm config enforces a release-age delay, blocks exotic transitive
  dependencies, and enables trust-regression checking or records a tested,
  explicit reason a specific check cannot be enabled yet.
- The build-script policy is explicit: dependency lifecycle scripts remain
  denied by default, and any allowed or ignored build dependency is named from
  the current dependency graph.
- A focused validation test or script proves the committed config contains the
  expected keys and that `packageManager` pins a pnpm version new enough to
  support them.
- The normal install path still works from the committed lockfile, or any
  required exception is recorded in the config with a narrow selector.
- Queue validation passes with the new policy files and no duplicate task ids.

## Source / Intent

Explorer run `2026-05-18T01-49-43-835Z-explorer-le9955` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add pnpm supply-chain hardening for dependency installs" --state ready --area architecture --priority p2 --summary "Configure repo-level pnpm supply-chain safeguards and validation so dependency installs delay fresh packages, reject trust regressions or exotic transitive sources, and keep exceptions explicit."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://openai.com/news/security/` now includes OpenAI's May 2026 security
  posts about Codex sandboxing, Codex deployment controls, and the TanStack npm
  supply-chain incident.
- The TanStack incident response specifically calls out package-manager
  configurations such as `minimumReleaseAge` and provenance validation as
  controls for reducing exposure to newly published compromised packages.
- `https://pnpm.io/supply-chain-security` documents pnpm's local mitigations:
  dependency build-script blocking, `blockExoticSubdeps`,
  `minimumReleaseAge`, `trustPolicy`, and committed lockfiles.

Local inspection found:

- `package.json` pins `"packageManager": "pnpm@10.32.1"`.
- `pnpm-lock.yaml` is committed.
- The repo has no `.npmrc`, `.pnpmfile.cjs`, or `pnpm-workspace.yaml`.
- Existing KOTA tasks already covered Codex runtime security telemetry and
  harness capability boundaries, so the nonduplicative gap is dependency
  install policy.

## Initiative

Repository supply-chain safety: dependency installs should have explicit,
repo-local guardrails that match the package manager KOTA already standardizes
on.

## Acceptance Evidence

- Focused test or validation transcript showing the pnpm supply-chain config is
  present, uses supported settings for the pinned pnpm version, and keeps
  exceptions narrow.
- `pnpm config list --location project` output or an equivalent fixture showing
  the effective release-age, exotic-dependency, and trust-policy settings.
- Install validation from the committed lockfile, such as
  `pnpm install --frozen-lockfile` in an environment where registry access is
  available, or a documented local equivalent when the workflow sandbox has no
  network.
- `pnpm run validate-tasks` passes.
