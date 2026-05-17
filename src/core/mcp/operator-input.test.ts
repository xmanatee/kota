import { afterEach, describe, expect, it, vi } from "vitest";
import { setPromptOverride } from "#core/tools/ask-user.js";
import {
  buildMcpInputResponseQuestion,
  createAskUserMcpInputResolver,
} from "./operator-input.js";

describe("MCP ask_user input resolver", () => {
  afterEach(() => {
    setPromptOverride(null);
  });

  it("routes operator JSON from ask_user into validated MCP inputResponses", async () => {
    const prompt = vi.fn(async () =>
      JSON.stringify({
        approval: {
          action: "accept",
          content: { approve: true },
        },
      }),
    );
    setPromptOverride(prompt);

    const resolver = createAskUserMcpInputResolver();
    const result = await resolver({
      server: "remote",
      tool: "confirmable",
      inputRequests: {
        approval: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "Approve remote action?",
          },
        },
      },
      requestState: "state-1",
    });

    expect(result).toEqual({
      kind: "respond",
      inputResponses: {
        approval: {
          action: "accept",
          content: { approve: true },
        },
      },
    });
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Remote MCP tool"));
  });

  it("returns unavailable when the operator answer is not valid inputResponses JSON", async () => {
    setPromptOverride(async () => "yes");

    const resolver = createAskUserMcpInputResolver();
    const result = await resolver({
      server: "remote",
      tool: "confirmable",
      inputRequests: {
        approval: {
          method: "elicitation/create",
          params: { mode: "form", message: "Approve remote action?" },
        },
      },
      requestState: "state-1",
    });

    if (result.kind !== "unavailable") {
      throw new Error("Expected unavailable resolver result");
    }
    expect(result.reason).toContain("valid MCP inputResponses");
  });
});

describe("buildMcpInputResponseQuestion", () => {
  it("includes request ids and remote tool identity", () => {
    const question = buildMcpInputResponseQuestion({
      server: "remote",
      tool: "confirmable",
      inputRequests: {
        approval: {
          method: "elicitation/create",
          params: { mode: "form", message: "Approve remote action?" },
        },
      },
      requestState: "state-1",
    });

    expect(question).toContain("confirmable");
    expect(question).toContain("remote");
    expect(question).toContain("approval");
    expect(question).toContain("input response objects");
  });
});
