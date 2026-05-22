import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPromptOverride } from "#core/tools/ask-user.js";
import {
  buildMcpAuthorizationQuestion,
  buildMcpInputResponseQuestion,
  createAskUserMcpAuthorizationResolver,
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

describe("MCP ask_user authorization resolver", () => {
  afterEach(() => {
    setPromptOverride(null);
  });

  it("returns the trimmed OAuth callback URL from the operator answer", async () => {
    const prompt = vi.fn(async (question: string) => {
      const callbackFilePath = question.match(/local file:\n(.+)\n\nThen reply/)?.[1];
      if (!callbackFilePath) {
        throw new Error("Expected callback file path in authorization question");
      }
      await writeFile(
        callbackFilePath,
        " https://client.example.test/callback?code=code-1&state=state-1 \n",
      );
      return "done";
    });
    setPromptOverride(prompt);

    const resolver = createAskUserMcpAuthorizationResolver();
    const result = await resolver({
      server: "remote",
      resource: "https://mcp.example.test/mcp",
      issuer: "https://auth.example.test",
      scopes: ["files:read"],
      authorizationUrl: "https://auth.example.test/authorize?state=state-1",
      state: "state-1",
    });

    expect(result.callbackUrl.reveal()).toBe("https://client.example.test/callback?code=code-1&state=state-1");
    expect(String(result.callbackUrl)).toBe("[redacted]");
    expect(JSON.stringify(result)).toBe('{"callbackUrl":"[redacted]"}');
    expect(JSON.stringify(result)).not.toContain("code-1");
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("remote"));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("https://auth.example.test/authorize?state=state-1"));
    expect(prompt).not.toHaveBeenCalledWith(expect.stringContaining("code-1"));
  });
});

describe("buildMcpAuthorizationQuestion", () => {
  it("names the protected resource, issuer, scopes, and callback instructions without asking for tokens", () => {
    const question = buildMcpAuthorizationQuestion({
      server: "remote",
      resource: "https://mcp.example.test/mcp",
      issuer: "https://auth.example.test",
      scopes: ["files:read", "files:write"],
      authorizationUrl: "https://auth.example.test/authorize?state=state-1",
      state: "state-1",
    }, "/tmp/kota-mcp-oauth/callback-url.txt");

    expect(question).toContain("remote");
    expect(question).toContain("https://mcp.example.test/mcp");
    expect(question).toContain("https://auth.example.test");
    expect(question).toContain("files:read files:write");
    expect(question).toContain("https://auth.example.test/authorize?state=state-1");
    expect(question).toContain("/tmp/kota-mcp-oauth/callback-url.txt");
    expect(question).toContain('reply "done"');
    expect(question).not.toContain("reply with the full redirect callback URL");
    expect(question).toContain("authorization code");
    expect(question).toContain("access tokens");
  });
});
