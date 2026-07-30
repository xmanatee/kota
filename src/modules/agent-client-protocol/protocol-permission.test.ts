import { describe, expect, it } from "vitest";
import { permissionRequestParams } from "./protocol-permission.js";

describe("ACP permission review", () => {
  it("renders safe input, conversation context, and the daemon review digest", () => {
    const params = permissionRequestParams({
      sessionId: "session-1",
      approvalId: "approval-1",
      toolUseId: "tool-1",
      toolName: "shell",
      input: {
        command: "curl -H 'Authorization: token command-secret' /srv/deploy --target production",
        API_KEY: "field-secret",
        path: "/srv/project",
      },
      risk: "dangerous",
      reason: "writes external state",
      timeoutMs: 120_000,
      context: "User: deploy /srv/project with token=context-secret",
      reviewDigest: "a".repeat(64),
    });

    expect(params).toMatchObject({
      toolCall: {
        rawInput: {
          command: "curl -H 'Authorization: [redacted]' /srv/deploy --target production",
          API_KEY: "[REDACTED]",
          path: "/srv/project",
        },
        content: [
          {
            content: {
              text: expect.stringContaining(`Review digest: ${"a".repeat(64)}`),
            },
          },
        ],
      },
    });
    const serialized = JSON.stringify(params);
    expect(serialized).toContain("Conversation context");
    expect(serialized).toContain("/srv/project");
    expect(serialized).not.toContain("command-secret");
    expect(serialized).not.toContain("field-secret");
    expect(serialized).not.toContain("context-secret");
  });

  it("preserves prototype-sensitive operation fields", () => {
    const input = JSON.parse(
      '{"command":"deploy","__proto__":{"operation":"replace","path":"/srv/app"}}',
    );
    const params = permissionRequestParams({
      sessionId: "session-1",
      approvalId: "approval-1",
      toolUseId: "tool-1",
      toolName: "shell",
      input,
      risk: "dangerous",
      reason: "writes external state",
      timeoutMs: 120_000,
    });

    expect(JSON.stringify(params)).toContain(
      '"__proto__":{"operation":"replace","path":"/srv/app"}',
    );
  });
});
