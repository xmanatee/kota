import type { UiActionParameterSpec, UiListItem, UiSurface } from "#core/daemon/ui-surface.js";
import {
  action,
  resultSpec,
  type SurfaceRead,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { ConfigValidateResult } from "./client.js";

function keyParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "key",
        label: "Configuration key",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
    ],
    schema: {
      type: "object",
      required: ["key"],
      properties: { key: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function setParameters(): UiActionParameterSpec {
  return {
    fields: [
      ...keyParameters().fields,
      {
        id: "value",
        label: "JSON or text value",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
    ],
    schema: {
      type: "object",
      required: ["key", "value"],
      properties: { key: { type: "string" }, value: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function configItems(config: SurfaceRead<ConfigValidateResult>): UiListItem[] {
  if (!config.ok) {
    return [{ id: "unavailable", title: "Configuration unavailable", detail: config.message, role: "warn" }];
  }
  const sources: UiListItem[] = config.value.sources.map((source) => ({
    id: `${source.label}-${source.path}`,
    title: `${source.label} configuration`,
    detail: source.path,
    role: "muted",
  }));
  const warnings: UiListItem[] = config.value.warnings.map((warning, index) => ({
    id: `warning-${index}`,
    title: "Configuration warning",
    detail: warning,
    role: "warn",
  }));
  return [...sources, ...warnings];
}

function buildConfigUiSurface(
  scopeId: string,
  config: SurfaceRead<ConfigValidateResult>,
): UiSurface {
  const getParameters = keyParameters();
  const writeParameters = setParameters();
  const validate = action({
    surfaceId: "configuration",
    actionId: "config.validate",
    scopeId,
    label: "Validate configuration",
    operation: { kind: "client-namespace", namespace: "config", method: "validate" },
    result: resultSpec("Configuration validated."),
  });
  const get = action({
    surfaceId: "configuration",
    actionId: "config.get",
    scopeId,
    label: "Read configuration value",
    operation: { kind: "client-namespace", namespace: "config", method: "get" },
    parameters: getParameters,
    result: resultSpec("Configuration value loaded."),
  });
  const set = action({
    surfaceId: "configuration",
    actionId: "config.set",
    scopeId,
    label: "Set configuration value",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "config", method: "set" },
    parameters: writeParameters,
    confirmation: {
      mode: "required",
      title: "Update project configuration?",
      detail: "This writes one key in the project configuration.",
      confirmLabel: "Update configuration",
      risk: "medium",
    },
    result: resultSpec("Configuration updated."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "configuration",
    extensionId: "config.operator",
    title: "Configuration",
    intent: "Setup",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Setup" },
    order: 51,
    refreshEvents: ["daemon.config.reload"],
    permissions: [{ kind: "capability-scope", scope: "control" }],
    nodes: [
      { kind: "list", title: "Configuration sources and warnings", items: configItems(config) },
      { kind: "form", title: "Read one value", fields: getParameters.fields, submit: get },
      { kind: "form", title: "Update one value", fields: writeParameters.fields, submit: set },
      { kind: "action-list", title: "Configuration actions", actions: [validate] },
    ],
    actions: [validate, get, set],
  };
}

export const configUiSurfaceSource: UiSurfaceSource = {
  sourceId: "configuration",
  project: async (context) => {
    const config = await context.read("configuration", () => context.client.config.validate());
    return [buildConfigUiSurface(context.scopeId, config)];
  },
};
