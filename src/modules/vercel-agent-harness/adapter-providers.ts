import type { LanguageModel, streamText } from "ai";
import type { AgentEffort } from "#core/agent-harness/index.js";

type ProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];
type ProviderFactory = (modelId: string) => Promise<LanguageModel>;

export async function loadAiSdk(): Promise<typeof import("ai")> {
  return import("ai");
}

const VERCEL_PROVIDER_REGISTRY: Record<string, ProviderFactory> = {
  openai: async (modelId: string) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI()(modelId);
  },
};

export async function resolveLanguageModel(modelString: string): Promise<{
  provider: string;
  model: LanguageModel;
}> {
  const slash = modelString.indexOf("/");
  if (slash <= 0 || slash === modelString.length - 1) {
    throw new Error(
      `The "vercel" agent harness expects model in "<provider>/<modelId>" form, got "${modelString}".`,
    );
  }
  const provider = modelString.slice(0, slash);
  const modelId = modelString.slice(slash + 1);
  const factory = VERCEL_PROVIDER_REGISTRY[provider];
  if (!factory) {
    throw new Error(
      `The "vercel" agent harness has no provider "${provider}" registered. ` +
        `Install @ai-sdk/${provider} and extend VERCEL_PROVIDER_REGISTRY, ` +
        `or use one of: ${Object.keys(VERCEL_PROVIDER_REGISTRY).join(", ")}.`,
    );
  }
  const model = await factory(modelId);
  return { provider, model };
}

export function mapEffortToProviderOptions(
  provider: string,
  effort: AgentEffort,
): ProviderOptions {
  if (provider === "openai") {
    const reasoningEffort: "low" | "medium" | "high" =
      effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
    return { openai: { reasoningEffort } };
  }
  throw new Error(
    `The "vercel" agent harness has no reasoning-effort mapping for provider "${provider}" ` +
      `(effort="${effort}"). Extend mapEffortToProviderOptions or run claude-agent-sdk.`,
  );
}
