import type {
  ModuleSetupFormField,
  ModuleSetupRequirementStatus,
  ModuleSetupStatusResponse,
} from "#modules/setup/client.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  resultSpec,
  type SurfaceRead,
  scopeIdForStatus,
  unavailableRows,
  uniqueActions,
} from "./operator-ui-builder-common.js";
import type {
  UiAction,
  UiActionOperation,
  UiActionParameterSpec,
  UiActionReadiness,
  UiCondition,
  UiFieldInput,
  UiFormField,
  UiNode,
  UiRole,
  UiSurface,
  UiTableRow,
} from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function setupFieldInput(field: ModuleSetupFormField): UiFieldInput {
  if (field.type === "boolean") return "boolean";
  if (field.type === "number") return "number";
  const id = field.id.toLowerCase();
  const configPath = field.configPath.toLowerCase();
  if (id.includes("url") || configPath.includes("url")) return "url";
  if (id.includes("path") || configPath.includes("path")) return "path";
  return "text";
}

const UI_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function isUiId(value: string): boolean {
  return UI_ID_PATTERN.test(value);
}

function supportsSetupUiActions(requirement: ModuleSetupRequirementStatus): boolean {
  return isUiId(requirement.moduleName) && isUiId(requirement.requirementId);
}

function hasUniqueParameterFields(parameters: UiActionParameterSpec | undefined): boolean {
  if (!parameters) return true;
  const seen = new Set<string>();
  for (const field of parameters.fields) {
    if (seen.has(field.id)) return false;
    seen.add(field.id);
  }
  return true;
}

function setupFormFieldSchema(field: ModuleSetupFormField): NonNullable<UiFormField["schema"]> {
  if (field.type === "boolean") return { type: "boolean" };
  if (field.type === "number") return { type: "number" };
  const input = setupFieldInput(field);
  return {
    type: "string",
    ...(field.valueKind === "secret-reference" ? { format: "secret-reference" as const } : {}),
    ...(input === "path" ? { format: "path" as const } : {}),
    ...(input === "url" ? { format: "url" as const } : {}),
  };
}

function setupFormField(field: ModuleSetupFormField): UiFormField {
  return {
    id: field.id,
    label: field.label,
    input: setupFieldInput(field),
    required: field.required,
    ...(field.options ? {
      options: field.options.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    } : {}),
    schema: setupFormFieldSchema(field),
  };
}

function setupFormParameters(requirement: ModuleSetupRequirementStatus): UiActionParameterSpec | undefined {
  if (requirement.setup.mode !== "form") return undefined;
  const fields = requirement.setup.fields.map(setupFormField);
  return {
    fields,
    schema: {
      type: "object",
      required: requirement.setup.fields.filter((field) => field.required).map((field) => field.id),
      properties: Object.fromEntries(
        requirement.setup.fields.map((field) => [field.id, setupFormFieldSchema(field)]),
      ),
      additionalProperties: false,
    },
  };
}

function setupSecretParameters(requirement: ModuleSetupRequirementStatus): UiActionParameterSpec | undefined {
  if (!requirement.secretRefs || requirement.secretRefs.length === 0) return undefined;
  return {
    fields: requirement.secretRefs.map((ref) => ({
      id: ref.name,
      label: ref.name,
      input: "secret",
      required: true,
      schema: {
        type: "string",
        description: "Secret value submitted through the setup secret path; clients must not render it back.",
      },
    })),
    schema: {
      type: "object",
      required: requirement.secretRefs.map((ref) => ref.name),
      properties: Object.fromEntries(
        requirement.secretRefs.map((ref) => [
          ref.name,
          {
            type: "string" as const,
            description: "Secret value submitted through the setup secret path; clients must not render it back.",
          },
        ]),
      ),
      additionalProperties: false,
    },
  };
}

function setupNeedsAction(state: ModuleSetupRequirementStatus["state"]): boolean {
  return state !== "ready";
}

function setupReadiness(requirement: ModuleSetupRequirementStatus): UiActionReadiness {
  if (!setupNeedsAction(requirement.state) || requirement.state === "pending") {
    return { state: "ready" };
  }
  return {
    state: "needs-setup",
    moduleName: requirement.moduleName,
    requirementId: requirement.requirementId,
    message: requirement.message,
  };
}

function setupCondition(requirement: ModuleSetupRequirementStatus): UiCondition {
  return {
    kind: "setup",
    moduleName: requirement.moduleName,
    requirementId: requirement.requirementId,
    state: requirement.state,
  };
}

function setupRoute(
  requirement: ModuleSetupRequirementStatus,
  suffix: "form" | "secret" | "start" | "refresh" | "revoke",
): UiActionOperation {
  const base = `/setup/requirements/${requirement.moduleName}/${requirement.requirementId}`;
  if (suffix === "revoke") {
    return { kind: "daemon-route", method: "DELETE", path: base };
  }
  return { kind: "daemon-route", method: "POST", path: `${base}/${suffix}` };
}

function setupRows(setup: SurfaceRead<ModuleSetupStatusResponse>, actions: readonly UiAction[]): UiTableRow[] {
  if (!setup.ok) return unavailableRows(setup.message);
  if (setup.value.requirements.length === 0) return emptyRows("Setup requirements");
  return setup.value.requirements.map((requirement) => ({
    id: `${requirement.moduleName}-${requirement.requirementId}`,
    cells: [
      { columnId: "name", value: `${requirement.moduleName}/${requirement.requirementId}`, role: requirement.state === "ready" ? "success" : "warn" },
      { columnId: "state", value: requirement.state, role: requirement.state === "ready" ? "success" : "warn" },
      {
        columnId: "detail",
        value: `${requirement.kind}; ${requirement.sensitivity}; ${requirement.setup.mode}; ${requirement.message}`,
        role: "muted",
      },
    ],
    action: actions.find((candidate) =>
      candidate.actionId.startsWith(`setup.${requirement.moduleName}.${requirement.requirementId}.`) &&
      candidate.effect !== "read"
    ),
  }));
}

function setupActions(scopeId: string, setup: SurfaceRead<ModuleSetupStatusResponse>): UiAction[] {
  const refresh = action({
    surfaceId: "setup",
    actionId: "setup.list",
    scopeId,
    label: "Reload setup requirements",
    operation: { kind: "client-namespace", namespace: "setup", method: "list" },
    result: resultSpec("Setup requirements loaded."),
  });
  if (!setup.ok) return [refresh];
  const actions: UiAction[] = [refresh];
  for (const requirement of setup.value.requirements) {
    if (!supportsSetupUiActions(requirement)) continue;
    const conditions = [setupCondition(requirement)];
    const formParameters = setupFormParameters(requirement);
    if (formParameters && hasUniqueParameterFields(formParameters)) {
      actions.push(action({
        surfaceId: "setup",
        actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.submit-form`,
        scopeId,
        label: `Submit ${requirement.moduleName}/${requirement.requirementId} form`,
        effect: "write",
        operation: setupRoute(requirement, "form"),
        parameters: formParameters,
        readiness: setupReadiness(requirement),
        conditions,
        result: resultSpec("Setup form submitted."),
      }));
    }

    const secretParameters = setupSecretParameters(requirement);
    if (secretParameters && hasUniqueParameterFields(secretParameters)) {
      actions.push(action({
        surfaceId: "setup",
        actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.store-secret`,
        scopeId,
        label: `Store ${requirement.moduleName}/${requirement.requirementId} secrets`,
        effect: "write",
        operation: setupRoute(requirement, "secret"),
        parameters: secretParameters,
        readiness: setupReadiness(requirement),
        conditions,
        result: resultSpec("Setup secrets stored."),
      }));
    }

    if (requirement.setup.mode === "url") {
      actions.push(
        action({
          surfaceId: "setup",
          actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.start`,
          scopeId,
          label: `Start ${requirement.moduleName}/${requirement.requirementId}`,
          effect: "external",
          operation: setupRoute(requirement, "start"),
          readiness: setupReadiness(requirement),
          conditions,
          result: resultSpec("Setup action started."),
        }),
      );
    }

    actions.push(action({
      surfaceId: "setup",
      actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.refresh`,
      scopeId,
      label: `Refresh ${requirement.moduleName}/${requirement.requirementId}`,
      operation: setupRoute(requirement, "refresh"),
      conditions,
      result: resultSpec("Setup status refreshed."),
    }));

    if (requirement.secretRefs || requirement.kind === "browser-profile" || requirement.pendingAction) {
      actions.push(action({
        surfaceId: "setup",
        actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.revoke`,
        scopeId,
        label: `Revoke ${requirement.moduleName}/${requirement.requirementId}`,
        effect: "write",
        operation: setupRoute(requirement, "revoke"),
        confirmation: {
          mode: "required",
          title: "Revoke setup",
          detail: "This removes stored setup state or credentials for the selected requirement.",
          confirmLabel: "Revoke setup",
          risk: "medium",
        },
        conditions,
        result: resultSpec("Setup revoked."),
      }));
    }
  }
  return uniqueActions(actions);
}

function setupActionForms(actions: readonly UiAction[]): UiNode[] {
  return actions.flatMap((candidate): UiNode[] => {
    if (!candidate.parameters) return [];
    if (!candidate.actionId.endsWith(".submit-form") && !candidate.actionId.endsWith(".store-secret")) {
      return [];
    }
    return [{
      kind: "form",
      title: candidate.label,
      fields: candidate.parameters.fields,
      submit: candidate,
    }];
  });
}

export function buildSetupUiSurface(args: {
  status: StatusSnapshot;
  setup: SurfaceRead<ModuleSetupStatusResponse>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const actions = setupActions(scopeId, args.setup);
  const forms = setupActionForms(actions);
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "setup",
    extensionId: "core.setup",
    title: "Setup",
    intent: "Setup",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Setup" },
    order: 50,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: args.setup.ok
          ? Object.entries(args.setup.value.summary).map(([label, value]) => ({
              label,
              value: `${value}`,
              role: value > 0 && label !== "ready" ? "warn" : "muted" as UiRole,
            }))
          : [{ label: "Setup", value: args.setup.message, role: "warn" }],
      },
      { kind: "table", title: "Setup and auth requirements", columns: NAME_STATE_DETAIL_COLUMNS, rows: setupRows(args.setup, actions) },
      ...forms,
      { kind: "action-list", title: "Setup actions", actions },
    ],
    actions,
  };
}
