import { describe, expect, it } from "vitest";
import {
  listShippedModelOutputTokenLimits,
  listShippedPresetModelIds,
  resolveModelOutputTokenLimit,
} from "./output-token-limits.js";

describe("model output-token limit resolver", () => {
  it("covers every shipped preset model id", () => {
    const shippedLimits = listShippedModelOutputTokenLimits();

    for (const model of listShippedPresetModelIds()) {
      const resolved = resolveModelOutputTokenLimit(model);
      expect(resolved).toEqual({
        model,
        matchedModel: model,
        maxTokens: shippedLimits[model],
        source: "shipped-preset",
      });
    }
  });

  it("keeps the shipped limit table scoped to shipped preset model ids", () => {
    const presetModels = new Set(listShippedPresetModelIds());
    for (const model of Object.keys(listShippedModelOutputTokenLimits())) {
      const providerless = model.includes("/")
        ? model.split("/").slice(1).join("/")
        : model;
      expect(
        presetModels.has(model) ||
          listShippedPresetModelIds().some((presetModel) => presetModel.endsWith(`/${providerless}`)),
        `orphan shipped limit for ${model}`,
      ).toBe(true);
    }
  });

  it("honors provider-prefixed model strings by matching the model id", () => {
    expect(resolveModelOutputTokenLimit("openai/gpt-5.4-mini")).toEqual({
      model: "openai/gpt-5.4-mini",
      matchedModel: "gpt-5.4-mini",
      maxTokens: 4096,
      source: "shipped-preset",
    });
  });

  it("covers OpenRouter's resolved model id after provider parsing", () => {
    expect(resolveModelOutputTokenLimit("openai/gpt-4.1-mini")).toEqual({
      model: "openai/gpt-4.1-mini",
      matchedModel: "openai/gpt-4.1-mini",
      maxTokens: 8192,
      source: "shipped-preset",
    });
  });

  it("lets an explicit operator limit cover an unknown model id", () => {
    expect(
      resolveModelOutputTokenLimit("openai/operator-model", {
        "operator-model": 12345,
      }),
    ).toEqual({
      model: "openai/operator-model",
      matchedModel: "operator-model",
      maxTokens: 12345,
      source: "operator-config",
    });
  });

  it("throws clearly for unknown models without an explicit limit", () => {
    expect(() => resolveModelOutputTokenLimit("openai/operator-model")).toThrow(
      /No output-token limit configured for model "openai\/operator-model"/,
    );
  });
});
