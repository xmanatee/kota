import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/index.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import { outboundHttpStreamingPort } from "#core/outbound-http/testing/request-port.js";
import { PROVIDER_PRESETS, parseModelString } from "#modules/model-clients/factory.js";
import { OpenAIModelClient } from "#modules/model-clients/openai/client.js";
import { resolveOpenAIModelCapabilities } from "#modules/model-clients/openrouter-capabilities.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";
import { type HarnessParityDeps, runHarnessParityMatrix } from "./harness-parity-operations.js";
import { matrixEstimatedCost } from "./model-matrix-execution.js";

let root: string;
let dispose: () => void;
let deps: HarnessParityDeps;
const requests: Array<{ model: string; max_tokens: number; reasoning?: object }> = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "matrix-request-"));
  mkdirSync(join(root, "scenario", "initial"), { recursive: true });
  writeFileSync(join(root, "scenario", "scenario.json"), JSON.stringify({ id: "scenario", description: "request boundary", prompt: "say ok", verification: { command: "node -e 'process.exit(0)'", timeoutMs: 1000 } }));
  dispose = registerAgentHarness(openaiToolsAgentHarness);
  vi.stubEnv("OPENROUTER_API_KEY", "matrix-test-key");
  requests.length = 0;
  registerModelClientFactory(({ model }) => {
    const parsed = parseModelString(model);
    const provider = parsed.provider!;
    return {
      providerName: provider, model: parsed.model,
      client: new OpenAIModelClient({
        baseUrl: "http://provider.test/v1", apiKey: "test", presetName: provider,
        effortTranslator: PROVIDER_PRESETS[provider]?.effortTranslator,
        modelCapabilities: resolveOpenAIModelCapabilities(provider, parsed.model),
        http: outboundHttpStreamingPort(async (request) => {
          requests.push(JSON.parse(String(request.body)));
          const chunk = { id: "response", model: parsed.model, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4 } };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
        }),
      }),
    };
  });
  deps = { scopeRoot: root, scenariosRoot: root, evalFixturesRoot: root, defaultOutBaseDir: join(root, "out"), kotaBinaryPath: "unused", config: { modelOutputTokenLimits: { "ollama/custom": 2048, "openrouter/moonshotai/kimi-k2.7-code": 4096 } } };
});
afterEach(() => { dispose(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it("encodes real local and Kimi scenario requests with configured token limits", async () => {
  const result = await runHarnessParityMatrix(deps, {
    scenarios: ["scenario"],
    baselines: [{ model: "ollama/custom", provider: "local" }],
    candidates: [{ model: "openrouter/moonshotai/kimi-k2.7-code", provider: "openrouter" }], maxTurns: 2,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.rows.map((row) => row.status)).toEqual(["passed", "passed"]);
  expect(requests).toMatchObject([{ model: "custom", max_tokens: 2048 }, { model: "moonshotai/kimi-k2.7-code", max_tokens: 4096 }]);
  expect(requests[0]).not.toHaveProperty("reasoning");
  expect(JSON.parse(readFileSync(join(result.rows[0]!.artifactDir!, "run-meta.json"), "utf8")).effort).toBeNull();
});

it("rejects explicit local effort before contacting a provider", async () => {
  const result = await runHarnessParityMatrix(deps, { scenarios: ["scenario"], baselines: [{ model: "ollama/custom", provider: "local" }], effort: "high" });
  expect(result).toMatchObject({ ok: false, reason: "invalid_harness_pair" });
  expect(requests).toEqual([]);
});

it("estimates complete unpriced token usage without fabricating unknown model costs", () => {
  const usage = { tokens: { state: "complete" as const, inputTokens: 100, outputTokens: 20 }, cost: { state: "unavailable" as const, reason: "provider-does-not-report" as const } };
  expect(matrixEstimatedCost("openrouter/z-ai/glm-5.2", usage)).toBeGreaterThan(0);
  expect(matrixEstimatedCost("ollama/custom", usage)).toBeNull();
  expect(matrixEstimatedCost("openrouter/z-ai/glm-5.2", { ...usage, tokens: { state: "partial", inputTokens: 100, outputTokens: 20 } })).toBeNull();
});
