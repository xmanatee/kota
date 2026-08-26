import { describe, expect, it } from "vitest";
import type { ModuleSetupRequirementStatus } from "../setup-requirements.js";
import {
  projectModuleSetupPendingActionForClient,
  projectModuleSetupStatusForClient,
} from "./status-utils.js";

const RAW_API_KEY = "sk-adversarial-value-1234567890";

function adversarialStatus(): ModuleSetupRequirementStatus {
  return {
    moduleName: "model-clients",
    requirementId: "openrouter-api-key",
    kind: "config",
    title: "OpenRouter API key credential",
    description: `OAuth token setup; token=${RAW_API_KEY}`,
    required: true,
    scope: "scope",
    owner: `credential-operator token=${RAW_API_KEY}`,
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [{
        id: "api-key-ref",
        label: `API key credential token=${RAW_API_KEY}`,
        type: "string",
        valueKind: "secret-reference",
        configPath: "modules.model-clients.openrouterApiKey",
        required: true,
        placeholder: `token=${RAW_API_KEY}`,
        helperText: `Use secret=${RAW_API_KEY}`,
        options: [{ value: "oauth-profile", label: `Token ${RAW_API_KEY}` }],
      }],
    },
    state: "revoked",
    reason: `api_key=${RAW_API_KEY}`,
    message: `API key credential was revoked; bearer=${RAW_API_KEY}`,
    secretRefs: [{
      name: "OPENROUTER_API_KEY",
      scope: "scope",
      present: false,
      source: `provider token=${RAW_API_KEY}`,
    }],
    configFields: [{
      id: "api-key-ref",
      label: `API key credential token=${RAW_API_KEY}`,
      configPath: "modules.model-clients.openrouterApiKey",
      required: true,
      present: true,
    }],
    capabilities: [{
      id: "openrouter.oauth-token",
      status: "unavailable",
      reason: `provider token=${RAW_API_KEY}`,
      message: `OAuth provider response contained token=${RAW_API_KEY}`,
    }],
    pendingAction: {
      actionId: "model-clients.openrouter-api-key.1770000000000",
      moduleName: "model-clients",
      requirementId: "openrouter-api-key",
      label: `Open OAuth token=${RAW_API_KEY}`,
      status: "revoked",
      createdAt: "2026-06-04T08:00:00.000Z",
      expiresAt: "2026-06-04T08:30:00.000Z",
      completedAt: "2026-06-04T08:05:00.000Z",
    },
  };
}

describe("setup requirement client projection", () => {
  it("preserves typed operational metadata while redacting only embedded values", () => {
    const projected = projectModuleSetupStatusForClient(adversarialStatus());

    expect(projected).toMatchObject({
      moduleName: "model-clients",
      requirementId: "openrouter-api-key",
      title: "OpenRouter API key credential",
      description: "OAuth token setup; token=[redacted]",
      owner: "credential-operator token=[redacted]",
      reason: "api_key=[redacted]",
      message: "API key credential was revoked; bearer=[redacted]",
      setup: {
        mode: "form",
        fields: [{
          id: "api-key-ref",
          label: "API key credential token=[redacted]",
          configPath: "modules.model-clients.openrouterApiKey",
          placeholder: "token=[redacted]",
          helperText: "Use secret=[redacted]",
          options: [{ value: "oauth-profile", label: "Token [redacted]" }],
        }],
      },
      secretRefs: [{
        name: "OPENROUTER_API_KEY",
        source: "provider token=[redacted]",
      }],
      configFields: [{
        id: "api-key-ref",
        label: "API key credential token=[redacted]",
        configPath: "modules.model-clients.openrouterApiKey",
      }],
      capabilities: [{
        id: "openrouter.oauth-token",
        reason: "provider token=[redacted]",
        message: "OAuth provider response contained token=[redacted]",
      }],
      pendingAction: {
        actionId: "model-clients.openrouter-api-key.1770000000000",
        moduleName: "model-clients",
        requirementId: "openrouter-api-key",
        label: "Open OAuth token=[redacted]",
      },
    });
    expect(JSON.stringify(projected)).not.toContain(RAW_API_KEY);
  });

  it("keeps durable pending action identifiers while omitting executable URLs", () => {
    const projected = projectModuleSetupPendingActionForClient(
      adversarialStatus().pendingAction!,
    );

    expect(projected.actionId).toBe("model-clients.openrouter-api-key.1770000000000");
    expect(projected.requirementId).toBe("openrouter-api-key");
    expect(projected.label).toBe("Open OAuth token=[redacted]");
    expect(projected).not.toHaveProperty("url");
  });
});
