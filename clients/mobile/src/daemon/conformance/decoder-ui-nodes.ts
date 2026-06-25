import { asArray, asKnown, asNumber, asObject, asOptionalString, asString } from './decoder-common';
import {
  parseOptionalUiConditions,
  parseOptionalUiPermissions,
  parseUiAction,
  parseUiAttachmentPoint,
  parseUiFormField,
} from './decoder-ui-schema';
import {
  UI_LINK_TARGET_KINDS,
  UI_LOG_LEVELS,
  UI_LOG_STREAM_SOURCE_KINDS,
  UI_NODE_KINDS,
  UI_PROTOCOL_VERSIONS,
  UI_ROLES,
  UI_INTENTS,
  type UiLinkTarget,
  type UiListItem,
  type UiLogEntry,
  type UiLogStreamSource,
  type UiNode,
  type UiSurface,
  type UiSurfaceBundle,
  type UiTab,
} from './decoder-ui-types';

function parseUiListItem(raw: unknown, field: string): UiListItem {
  const obj = asObject(raw, field);
  return {
    id: asString(obj.id, `${field}.id`),
    title: asString(obj.title, `${field}.title`),
    detail: asString(obj.detail, `${field}.detail`),
    role: asKnown(obj.role, `${field}.role`, UI_ROLES),
    action: obj.action === undefined ? undefined : parseUiAction(obj.action, `${field}.action`),
  };
}

function parseUiLinkTarget(raw: unknown, field: string): UiLinkTarget {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_LINK_TARGET_KINDS);
  if (kind === "surface") {
    return { kind, surfaceId: asString(obj.surfaceId, `${field}.surfaceId`) };
  }
  if (kind === "daemon-route") {
    return { kind, path: asString(obj.path, `${field}.path`) };
  }
  return { kind, url: asString(obj.url, `${field}.url`) };
}

function parseUiTab(raw: unknown, field: string): UiTab {
  const obj = asObject(raw, field);
  return {
    id: asString(obj.id, `${field}.id`),
    label: asString(obj.label, `${field}.label`),
    nodes: asArray(obj.nodes, `${field}.nodes`).map((entry, index) =>
      parseUiNode(entry, `${field}.nodes[${index}]`)
    ),
  };
}

function parseUiLogEntry(raw: unknown, field: string): UiLogEntry {
  const obj = asObject(raw, field);
  return {
    timestamp: asString(obj.timestamp, `${field}.timestamp`),
    level: asKnown(obj.level, `${field}.level`, UI_LOG_LEVELS),
    message: asString(obj.message, `${field}.message`),
    source: asOptionalString(obj.source, `${field}.source`),
  };
}

function parseUiLogStreamSource(raw: unknown, field: string): UiLogStreamSource {
  const obj = asObject(raw, field);
  return {
    kind: asKnown(obj.kind, `${field}.kind`, UI_LOG_STREAM_SOURCE_KINDS),
    path: asString(obj.path, `${field}.path`),
    eventTypes: asArray(obj.eventTypes, `${field}.eventTypes`).map((entry, index) =>
      asString(entry, `${field}.eventTypes[${index}]`)
    ),
  };
}

function parseUiNode(raw: unknown, field: string): UiNode {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_NODE_KINDS);
  switch (kind) {
    case "navigation":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        items: asArray(obj.items, `${field}.items`).map((entry, index) => {
          const item = asObject(entry, `${field}.items[${index}]`);
          return {
            surfaceId: asString(item.surfaceId, `${field}.items[${index}].surfaceId`),
            label: asString(item.label, `${field}.items[${index}].label`),
          };
        }),
      };
    case "status-summary":
      return {
        kind,
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) => {
          const item = asObject(entry, `${field}.entries[${index}]`);
          return {
            label: asString(item.label, `${field}.entries[${index}].label`),
            value: asString(item.value, `${field}.entries[${index}].value`),
            role: asKnown(item.role, `${field}.entries[${index}].role`, UI_ROLES),
          };
        }),
      };
    case "metrics":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        metrics: asArray(obj.metrics, `${field}.metrics`).map((entry, index) => {
          const item = asObject(entry, `${field}.metrics[${index}]`);
          return {
            label: asString(item.label, `${field}.metrics[${index}].label`),
            value: asString(item.value, `${field}.metrics[${index}].value`),
            unit: asOptionalString(item.unit, `${field}.metrics[${index}].unit`),
            role: asKnown(item.role, `${field}.metrics[${index}].role`, UI_ROLES),
          };
        }),
      };
    case "text":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        body: asString(obj.body, `${field}.body`),
        role: obj.role === undefined ? undefined : asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "link":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        target: parseUiLinkTarget(obj.target, `${field}.target`),
        role: obj.role === undefined ? undefined : asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "tabs":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        activeTabId: asString(obj.activeTabId, `${field}.activeTabId`),
        tabs: asArray(obj.tabs, `${field}.tabs`).map((entry, index) =>
          parseUiTab(entry, `${field}.tabs[${index}]`)
        ),
      };
    case "list":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        items: asArray(obj.items, `${field}.items`).map((entry, index) =>
          parseUiListItem(entry, `${field}.items[${index}]`)
        ),
      };
    case "table":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        columns: asArray(obj.columns, `${field}.columns`).map((entry, index) => {
          const item = asObject(entry, `${field}.columns[${index}]`);
          return {
            id: asString(item.id, `${field}.columns[${index}].id`),
            label: asString(item.label, `${field}.columns[${index}].label`),
            role: item.role === undefined ? undefined : asKnown(item.role, `${field}.columns[${index}].role`, UI_ROLES),
          };
        }),
        rows: asArray(obj.rows, `${field}.rows`).map((entry, index) => {
          const row = asObject(entry, `${field}.rows[${index}]`);
          return {
            id: asString(row.id, `${field}.rows[${index}].id`),
            cells: asArray(row.cells, `${field}.rows[${index}].cells`).map((cellEntry, cellIndex) => {
              const cell = asObject(cellEntry, `${field}.rows[${index}].cells[${cellIndex}]`);
              return {
                columnId: asString(cell.columnId, `${field}.rows[${index}].cells[${cellIndex}].columnId`),
                value: asString(cell.value, `${field}.rows[${index}].cells[${cellIndex}].value`),
                role: cell.role === undefined
                  ? undefined
                  : asKnown(cell.role, `${field}.rows[${index}].cells[${cellIndex}].role`, UI_ROLES),
              };
            }),
            action: row.action === undefined ? undefined : parseUiAction(row.action, `${field}.rows[${index}].action`),
          };
        }),
      };
    case "detail":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        body: asString(obj.body, `${field}.body`),
      };
    case "progress":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        value: asNumber(obj.value, `${field}.value`),
        max: asNumber(obj.max, `${field}.max`),
        role: asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "log":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) =>
          parseUiLogEntry(entry, `${field}.entries[${index}]`)
        ),
      };
    case "log-stream":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        streamId: asString(obj.streamId, `${field}.streamId`),
        source: parseUiLogStreamSource(obj.source, `${field}.source`),
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) =>
          parseUiLogEntry(entry, `${field}.entries[${index}]`)
        ),
      };
    case "form":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        fields: asArray(obj.fields, `${field}.fields`).map((entry, index) =>
          parseUiFormField(entry, `${field}.fields[${index}]`)
        ),
        submit: parseUiAction(obj.submit, `${field}.submit`),
      };
    case "action-list":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        actions: asArray(obj.actions, `${field}.actions`).map((entry, index) =>
          parseUiAction(entry, `${field}.actions[${index}]`)
        ),
      };
    case "command":
      return {
        kind,
        action: parseUiAction(obj.action, `${field}.action`),
      };
    case "empty":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        detail: asString(obj.detail, `${field}.detail`),
        action: parseUiAction(obj.action, `${field}.action`),
      };
    case "error":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        detail: asString(obj.detail, `${field}.detail`),
        action: parseUiAction(obj.action, `${field}.action`),
      };
  }
}

function parseUiSurface(raw: unknown, field: string): UiSurface {
  const obj = asObject(raw, field);
  return {
    protocolVersion: asKnown(obj.protocolVersion, `${field}.protocolVersion`, UI_PROTOCOL_VERSIONS),
    surfaceId: asString(obj.surfaceId, `${field}.surfaceId`),
    extensionId: asString(obj.extensionId, `${field}.extensionId`),
    title: asString(obj.title, `${field}.title`),
    intent: asKnown(obj.intent, `${field}.intent`, UI_INTENTS),
    scopeId: asString(obj.scopeId, `${field}.scopeId`),
    attachmentPoint: parseUiAttachmentPoint(obj.attachmentPoint, `${field}.attachmentPoint`),
    order: asNumber(obj.order, `${field}.order`),
    conditions: parseOptionalUiConditions(obj.conditions, `${field}.conditions`),
    permissions: parseOptionalUiPermissions(obj.permissions, `${field}.permissions`),
    nodes: asArray(obj.nodes, `${field}.nodes`).map((entry, index) =>
      parseUiNode(entry, `${field}.nodes[${index}]`)
    ),
    actions: asArray(obj.actions, `${field}.actions`).map((entry, index) =>
      parseUiAction(entry, `${field}.actions[${index}]`)
    ),
  };
}

export function parseUiSurfaceBundle(raw: unknown): UiSurfaceBundle {
  const obj = asObject(raw, "uiSurfaces");
  return {
    protocolVersion: asKnown(obj.protocolVersion, "uiSurfaces.protocolVersion", UI_PROTOCOL_VERSIONS),
    surfaces: asArray(obj.surfaces, "uiSurfaces.surfaces").map((entry, index) =>
      parseUiSurface(entry, `uiSurfaces.surfaces[${index}]`)
    ),
  };
}
