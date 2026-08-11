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
    const shippedLimits = listShippedModelOutputTokenLimits();
    const model = listShippedPresetModelIds().find((candidate) => !candidate.includes("/"));
    if (!model) throw new Error("expected a providerless shipped model id");
    const prefixedModel = `provider/${model}`;
    expect(resolveModelOutputTokenLimit(prefixedModel)).toEqual({
      model: prefixedModel,
      matchedModel: model,
      maxTokens: shippedLimits[model],
      source: "shipped-preset",
    });
  });

  it("covers a provider-routed preset model after the outer provider is parsed", () => {
    const shippedLimits = listShippedModelOutputTokenLimits();
    const canonicalModel = listShippedPresetModelIds().find(
      (candidate) => candidate.split("/").length > 2,
    );
    if (!canonicalModel) throw new Error("expected a nested provider-routed model id");
    const parsedModel = canonicalModel.split("/").slice(1).join("/");
    expect(resolveModelOutputTokenLimit(parsedModel)).toEqual({
      model: parsedModel,
      matchedModel: parsedModel,
      maxTokens: shippedLimits[parsedModel],
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
