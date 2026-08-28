import type {
  UiAction,
  UiNode,
  UiRole,
} from "../../../../conformance/ui-surface.generated";

export function roleClass(role: UiRole | undefined): string {
  switch (role) {
    case undefined:
    case "neutral":
      return "text-foreground";
    case "muted":
      return "text-muted-foreground";
    case "info":
      return "text-info-foreground";
    case "success":
      return "text-success-foreground";
    case "warn":
      return "text-warning-foreground";
    case "error":
      return "text-destructive";
    default:
      return assertNever(role);
  }
}

export function referencedActionIds(nodes: readonly UiNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) collectNodeActionIds(node, ids);
  return ids;
}

export function embeddedActionIds(nodes: readonly UiNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) collectNodeActionIds(node, ids, true);
  return ids;
}

function collectNodeActionIds(
  node: UiNode,
  ids: Set<string>,
  skipActionLists = false,
): void {
  switch (node.kind) {
    case "navigation":
    case "status-summary":
    case "metrics":
    case "text":
    case "link":
    case "detail":
    case "progress":
    case "log":
    case "log-stream":
      return;
    case "tabs":
      for (const tab of node.tabs) {
        for (const child of tab.nodes) {
          collectNodeActionIds(child, ids, skipActionLists);
        }
      }
      return;
    case "list":
      for (const item of node.items) {
        if (item.action) ids.add(item.action.actionId);
      }
      return;
    case "table":
      for (const row of node.rows) {
        if (row.action) ids.add(row.action.actionId);
      }
      return;
    case "form":
      ids.add(node.submit.actionId);
      return;
    case "action-list":
      if (!skipActionLists) {
        for (const action of node.actions) ids.add(action.actionId);
      }
      return;
    case "command":
      ids.add(node.action.actionId);
      return;
    case "empty":
    case "error":
      ids.add(node.action.actionId);
      return;
    default:
      assertNever(node);
  }
}

export function rowActionDefaults(
  action: UiAction,
  rowId: string,
): Readonly<Record<string, string>> {
  const required = action.parameters?.schema.required ?? [];
  const idFields = required.filter((id) => /id$/i.test(id));
  return idFields.length === 1 && idFields[0] ? { [idFields[0]]: rowId } : {};
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled ui.surface.v1 arm: ${JSON.stringify(value)}`);
}
