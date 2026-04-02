---
id: task-doctor-api-connectivity-check
title: Add provider API connectivity validation to kota doctor
status: ready
priority: p2
area: cli
summary: kota doctor checks config and extensions but never validates that configured AI provider API keys are valid or that the model endpoint is reachable, leaving operators with silent misconfiguration until a workflow run fails.
created_at: 2026-04-02T11:49:09Z
updated_at: 2026-04-02T12:00:00Z
---

## Problem

`kota doctor` validates disk layout, config files, workflow definitions, and extension loading, but it does not test AI provider connectivity. An operator who mis-types an API key, uses an expired key, or configures a model name that doesn't exist will only discover the error when a live workflow run fails — often minutes into an autonomous session, after spending context and potentially budget.

The providers config already lists API keys and model settings; there is enough information to run a quick connectivity probe at doctor time.

## Desired Outcome

`kota doctor` adds a provider connectivity check that:

- Iterates configured providers from `config.providers`.
- For each provider, sends a minimal test request (e.g., a 1-token completion or a models/list API call) to verify the API key is valid and the endpoint is reachable.
- Emits a `pass` result if the probe succeeds, a `warn` if the provider is configured but key is a placeholder, or a `fail` if the endpoint returns 401/403 or is unreachable.
- Reports the model name and endpoint in the check detail so the operator can diagnose.

The check should be skippable via `--skip-connectivity` for offline environments.

## Constraints

- Use the existing `ModelClient` abstraction; do not duplicate HTTP client code.
- The probe must be cheap: minimal tokens, no streaming, no tool calls.
- Do not expose raw API key values in the output — show key prefix only (e.g., `sk-ant-...`).
- `--skip-connectivity` flag bypasses all provider probes and outputs a `warn` instead of running them.
- Existing `checkProvidersConfig` function in `doctor-cli.ts` should be extended, not replaced.

## Done When

- `kota doctor` runs a connectivity probe for each configured provider.
- A valid API key emits `pass`; an invalid or unreachable key emits `fail` with a short diagnostic.
- `kota doctor --skip-connectivity` skips the probes and warns that connectivity was not checked.
- Unit tests cover the check result for a mocked successful, unauthorized, and unreachable provider response.
