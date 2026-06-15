# Vercel Agent Harness Module

Adapter module that registers the `vercel` harness: a multi-turn tool loop
driven by the Vercel AI SDK. Operators select it through
`KotaConfig.defaultAgentHarness`, per-step `harness`, or `--harness vercel`.

This module owns the `KotaTool` to Vercel `ToolSet` translation at the adapter
seam.

## Provider Routing

Models are addressed as `<providerKey>/<modelId>`. The shipped provider key is
`openai`, backed by `@ai-sdk/openai` and `OPENAI_API_KEY`. Adding another
provider means extending the local provider registry in `adapter.ts`. This
module does not use `model-clients`; the Vercel SDK is its own wire and
tool-loop primitive.

## Loop Shape

The adapter calls `streamText` with KOTA tools, optional system text,
`stopWhen: stepCountIs(maxTurns)`, and the abort signal. The SDK owns the
multi-step tool loop; the adapter forwards streamed text and normalizes final
usage, steps, finish reason, and text into `AgentHarnessResult`.

Guardrails are applied inside `Tool.execute`. Filtered tools are not exposed to
the model, and `canUseTool` can update inputs, return a denial as a tool
result, or interrupt the run.

## Reasoning Effort

`AgentHarnessRunOptions.effort` maps to provider-native reasoning settings on
`streamText.providerOptions` at this adapter seam. The OpenAI mapping collapses
KOTA effort to OpenAI's `low`, `medium`, and `high`.

## Protocol Errors

A tool input that is not a JSON object after SDK schema validation throws
before reaching the tool runner. Coercion belongs at the wire boundary only.
