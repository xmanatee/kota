import {
  UI_SURFACE_PROTOCOL_VERSION,
  type UiAction,
  type UiNode,
  type UiSurface,
  type UiSurfaceBundle,
} from "./ui-surface.js";
import { validateAction } from "./ui-surface-action-validation.js";
import {
  errorIf,
  UI_INTENTS,
  UI_NODE_KINDS,
  UI_ROLES,
  validateAttachmentPoint,
  validateConditions,
  validateFormField,
  validateId,
  validateKnown,
  validateLinkTarget,
  validateLogEntry,
  validateLogStreamSource,
  validateOptionalKnown,
  validatePermissions,
  validateUnique,
} from "./ui-surface-validation-helpers.js";

export class UiSurfaceValidationError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(errors.join("\n"));
    this.name = "UiSurfaceValidationError";
  }
}

function collectNodeActions(node: UiNode): readonly UiAction[] {
  switch (node.kind) {
    case "tabs":
      return [];
    case "list":
      return node.items.flatMap((item) => item.action ? [item.action] : []);
    case "table":
      return node.rows.flatMap((row) => row.action ? [row.action] : []);
    case "form":
      return [node.submit];
    case "action-list":
      return node.actions;
    case "command":
    case "empty":
    case "error":
      return [node.action];
    default:
      return [];
  }
}

function collectSurfaceNodeActions(nodes: readonly UiNode[]): UiAction[] {
  return nodes.flatMap((node) =>
    node.kind === "tabs"
      ? node.tabs.flatMap((tab) => collectSurfaceNodeActions(tab.nodes))
      : collectNodeActions(node),
  );
}

function validateNode(node: UiNode, label: string, errors: string[]): void {
  const kind = node.kind;
  if (!validateKnown(kind, UI_NODE_KINDS, `${label}.kind`, errors)) return;
  switch (kind) {
    case "navigation":
      for (const item of node.items) validateId(item.surfaceId, `${label}.items.surfaceId`, errors);
      break;
    case "status-summary":
      for (const entry of node.entries) validateKnown(entry.role, UI_ROLES, `${label}.entries.role`, errors);
      break;
    case "metrics":
      for (const metric of node.metrics) validateKnown(metric.role, UI_ROLES, `${label}.metrics.role`, errors);
      break;
    case "text":
      validateOptionalKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "link":
      validateLinkTarget(node.target, `${label}.target`, errors);
      validateOptionalKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "tabs": {
      const tabs = new Set<string>();
      for (const tab of node.tabs) {
        validateId(tab.id, `${label}.tabs.id`, errors);
        validateUnique(tab.id, tabs, `${label} tab id`, errors);
        for (const child of tab.nodes) {
          validateNode(child, `${label}.tabs.${tab.id} node ${child.kind}`, errors);
        }
      }
      errorIf(!tabs.has(node.activeTabId), errors, `${label}.activeTabId references unknown tab "${node.activeTabId}"`);
      break;
    }
    case "list":
      for (const item of node.items) validateKnown(item.role, UI_ROLES, `${label}.items.role`, errors);
      break;
    case "table": {
      const columns = new Set<string>();
      for (const column of node.columns) {
        validateId(column.id, `${label}.columns.id`, errors);
        validateUnique(column.id, columns, `${label} column id`, errors);
        validateOptionalKnown(column.role, UI_ROLES, `${label}.columns.${column.id}.role`, errors);
      }
      for (const row of node.rows) {
        for (const cell of row.cells) {
          errorIf(!columns.has(cell.columnId), errors, `${label} row "${row.id}" references unknown column "${cell.columnId}"`);
          validateOptionalKnown(cell.role, UI_ROLES, `${label}.rows.${row.id}.cells.${cell.columnId}.role`, errors);
        }
      }
      break;
    }
    case "detail":
      break;
    case "progress":
      errorIf(node.max <= 0, errors, `${label}.max must be positive`);
      errorIf(node.value < 0 || node.value > node.max, errors, `${label}.value must be between 0 and max`);
      validateKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "log":
      for (const [index, entry] of node.entries.entries()) {
        validateLogEntry(entry, `${label}.entries.${index}`, errors);
      }
      break;
    case "log-stream":
      validateId(node.streamId, `${label}.streamId`, errors);
      validateLogStreamSource(node.source, `${label}.source`, errors);
      for (const [index, entry] of node.entries.entries()) {
        validateLogEntry(entry, `${label}.entries.${index}`, errors);
      }
      break;
    case "form": {
      const fields = new Set<string>();
      for (const field of node.fields) {
        validateUnique(field.id, fields, `${label} field id`, errors);
        validateFormField(field, `${label}.fields.${field.id}`, errors);
      }
      break;
    }
    case "action-list":
    case "command":
    case "empty":
    case "error":
      break;
  }
  for (const action of collectNodeActions(node)) {
    validateAction(action, `${label}.${action.actionId}`, errors);
  }
}

export function validateUiSurfaceBundle(bundle: UiSurfaceBundle): UiSurfaceBundle {
  const errors: string[] = [];
  errorIf(bundle.protocolVersion !== UI_SURFACE_PROTOCOL_VERSION, errors, `protocolVersion must be ${UI_SURFACE_PROTOCOL_VERSION}`);
  const surfaceIds = new Set<string>();
  const extensionIds = new Set<string>();
  const actionIds = new Set<string>();

  for (const surface of bundle.surfaces) {
    validateId(surface.surfaceId, "surfaceId", errors);
    validateId(surface.extensionId, "extensionId", errors);
    validateKnown(surface.intent, UI_INTENTS, `surface ${surface.surfaceId}.intent`, errors);
    validateUnique(surface.surfaceId, surfaceIds, "surfaceId", errors);
    validateUnique(surface.extensionId, extensionIds, "extensionId", errors);
  }

  for (const surface of bundle.surfaces) {
    validateAttachmentPoint(surface.attachmentPoint, surfaceIds, surface.surfaceId, errors);
    const refreshEvents = new Set<string>();
    for (const eventType of surface.refreshEvents ?? []) {
      validateId(eventType, `surface ${surface.surfaceId}.refreshEvents`, errors);
      validateUnique(eventType, refreshEvents, `surface ${surface.surfaceId} refresh event`, errors);
    }
    validateConditions(surface.conditions, `surface ${surface.surfaceId}`, errors);
    validatePermissions(surface.permissions, `surface ${surface.surfaceId}`, errors);
    for (const node of surface.nodes) {
      validateNode(node, `surface ${surface.surfaceId} node ${node.kind}`, errors);
    }
    const listedActionIds = new Set(surface.actions.map((action) => action.actionId));
    for (const embeddedAction of collectSurfaceNodeActions(surface.nodes)) {
      errorIf(
        !listedActionIds.has(embeddedAction.actionId),
        errors,
        `surface "${surface.surfaceId}" node action "${embeddedAction.actionId}" is missing from surface.actions`,
      );
    }
    for (const action of surface.actions) {
      errorIf(action.surfaceId !== surface.surfaceId, errors, `action "${action.actionId}" belongs to "${action.surfaceId}" but is listed on "${surface.surfaceId}"`);
      validateUnique(`${surface.surfaceId}:${action.actionId}`, actionIds, "actionId", errors);
      validateAction(action, `surface ${surface.surfaceId} action ${action.actionId}`, errors);
    }
  }

  if (errors.length > 0) throw new UiSurfaceValidationError(errors);
  return bundle;
}

export function assembleValidatedUiSurfaceBundle(
  surfaces: readonly UiSurface[],
): UiSurfaceBundle {
  return validateUiSurfaceBundle({
    protocolVersion: UI_SURFACE_PROTOCOL_VERSION,
    surfaces: [...surfaces].sort((a, b) =>
      a.order - b.order || a.surfaceId.localeCompare(b.surfaceId)),
  });
}
