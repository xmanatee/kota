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

  it("routes URL-mode consent without requiring form content", async () => {
    const prompt = vi.fn(async () =>
      JSON.stringify({
        oauth: {
          action: "accept",
        },
      }),
    );
    setPromptOverride(prompt);

    const resolver = createAskUserMcpInputResolver();
    const result = await resolver({
      server: "remote-auth",
      tool: "oauth_start",
      inputRequests: {
        oauth: {
          method: "elicitation/create",
          params: {
            mode: "url",
            message: "Please authorize Example Auth.",
            url: "https://auth.example.test/consent?state=abc",
            elicitationId: "oauth-abc",
          },
        },
      },
      requestState: "state-url",
    });

    expect(result).toEqual({
      kind: "respond",
      inputResponses: {
        oauth: {
          action: "accept",
        },
      },
    });
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("remote-auth"));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("oauth_start"));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("https://auth.example.test/consent?state=abc"));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("oauth-abc"));
  });

  it("rejects URL-mode operator answers with pasted credential fields", async () => {
    const prompt = vi.fn(async () =>
      JSON.stringify({
        oauth: {
          action: "accept",
          code: "secret",
        },
      }),
    );
    setPromptOverride(prompt);

    const resolver = createAskUserMcpInputResolver();
    const result = await resolver({
      server: "remote-auth",
      tool: "oauth_start",
      inputRequests: {
        oauth: {
          method: "elicitation/create",
          params: {
            mode: "url",
            message: "Please authorize Example Auth.",
            url: "https://auth.example.test/consent?state=abc",
            elicitationId: "oauth-abc",
          },
        },
      },
      requestState: "state-url",
    });

    if (result.kind !== "unavailable") {
      throw new Error("Expected unavailable resolver result");
    }
    expect(result.reason).toContain("inputResponses.oauth must include only action");
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
    expect(question).toContain('Use action "decline"');
  });

  it("includes URL-mode identity and consent-only instructions", () => {
    const question = buildMcpInputResponseQuestion({
      server: "remote-auth",
      tool: "oauth_start",
      inputRequests: {
        oauth: {
          method: "elicitation/create",
          params: {
            mode: "url",
            message: "Please authorize Example Auth.",
            url: "https://auth.example.test/consent?state=abc",
            elicitationId: "oauth-abc",
          },
        },
      },
      requestState: "state-url",
    });

    expect(question).toContain("URL-mode requests");
    expect(question).toContain("remote-auth");
    expect(question).toContain("oauth_start");
    expect(question).toContain("Please authorize Example Auth.");
    expect(question).toContain("https://auth.example.test/consent?state=abc");
    expect(question).toContain("oauth-abc");
    expect(question).toContain('{"request_id":{"action":"accept"}}');
  });
});
