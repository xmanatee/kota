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
    owner: "credential-operator",
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [{
        id: "api-key-ref",
        label: "API key credential reference",
        type: "string",
        valueKind: "secret-reference",
        configPath: "modules.model-clients.openrouterApiKey",
        required: true,
        placeholder: "$OPENROUTER_API_KEY",
        helperText: "Use an OAuth token secret reference, not a raw API key.",
        options: [{ value: "$OPENROUTER_API_KEY", label: "API key token reference" }],
      }],
    },
    state: "revoked",
    reason: "api_key_credentials_revoked",
    message: `API key credential was revoked; bearer=${RAW_API_KEY}`,
    secretRefs: [{
      name: "OPENROUTER_API_KEY",
      scope: "scope",
      present: false,
      source: "project-secret-provider",
    }],
    configFields: [{
      id: "api-key-ref",
      label: "API key credential reference",
      configPath: "modules.model-clients.openrouterApiKey",
      required: true,
      present: true,
    }],
    capabilities: [{
      id: "openrouter.oauth-token",
      status: "unavailable",
      reason: "provider_api_key_revoked",
      message: `OAuth provider response contained token=${RAW_API_KEY}`,
    }],
    pendingAction: {
      actionId: "model-clients.openrouter-api-key.1770000000000",
      moduleName: "model-clients",
      requirementId: "openrouter-api-key",
      url: `https://auth.example.test/oauth/credentials?api_key=${RAW_API_KEY}&next=%2Fapi-key`,
      label: "Open OAuth API key credentials",
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
      owner: "credential-operator",
      reason: "api_key_credentials_revoked",
      message: "API key credential was revoked; bearer=[redacted]",
      setup: {
        mode: "form",
        fields: [{
          id: "api-key-ref",
          label: "API key credential reference",
          configPath: "modules.model-clients.openrouterApiKey",
          placeholder: "$OPENROUTER_API_KEY",
          helperText: "Use an OAuth token secret reference, not a raw API key.",
          options: [{ value: "$OPENROUTER_API_KEY", label: "API key token reference" }],
        }],
      },
      secretRefs: [{
        name: "OPENROUTER_API_KEY",
        source: "project-secret-provider",
      }],
      configFields: [{
        id: "api-key-ref",
        label: "API key credential reference",
        configPath: "modules.model-clients.openrouterApiKey",
      }],
      capabilities: [{
        id: "openrouter.oauth-token",
        reason: "provider_api_key_revoked",
        message: "OAuth provider response contained token=[redacted]",
      }],
      pendingAction: {
        actionId: "model-clients.openrouter-api-key.1770000000000",
        moduleName: "model-clients",
        requirementId: "openrouter-api-key",
        url: "https://auth.example.test/oauth/credentials?api_key=%5Bredacted%5D&next=%2Fapi-key",
        label: "Open OAuth API key credentials",
      },
    });
    expect(JSON.stringify(projected)).not.toContain(RAW_API_KEY);
  });

  it("keeps pending action identifiers executable while sanitizing secret query values", () => {
    const projected = projectModuleSetupPendingActionForClient(
      adversarialStatus().pendingAction!,
    );

    expect(projected.actionId).toBe("model-clients.openrouter-api-key.1770000000000");
    expect(projected.requirementId).toBe("openrouter-api-key");
    expect(projected.label).toBe("Open OAuth API key credentials");
    expect(projected.url).toBe(
      "https://auth.example.test/oauth/credentials?api_key=%5Bredacted%5D&next=%2Fapi-key",
    );
  });
});
