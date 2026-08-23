import type {
  UiAction,
  UiIntent,
  UiNode,
  UiSurface,
  UiSurfaceBundle,
} from '../daemon/conformance/ui-surface.generated';

export type UiDeepLinkTarget = {
  surfaceId: string;
  actionId?: string;
};

export function orderedIntents(bundle: UiSurfaceBundle): UiIntent[] {
  const intents: UiIntent[] = [];
  for (const surface of orderedSurfaces(bundle.surfaces)) {
    if (!intents.includes(surface.intent)) intents.push(surface.intent);
  }
  return intents;
}

export function surfacesForIntent(
  bundle: UiSurfaceBundle,
  intent: UiIntent,
): UiSurface[] {
  return orderedSurfaces(
    bundle.surfaces.filter((surface) => surface.intent === intent),
  );
}

export function entrySurface(
  surfaces: readonly UiSurface[],
): UiSurface | undefined {
  return (
    surfaces.find((surface) => surface.attachmentPoint.kind === 'root') ??
    surfaces.find((surface) => surface.attachmentPoint.kind === 'intent') ??
    surfaces[0]
  );
}

export function resolveDeepLink(
  bundle: UiSurfaceBundle,
  target: UiDeepLinkTarget,
): { surface: UiSurface; actionId?: string } | null {
  const surface = bundle.surfaces.find(
    (candidate) => candidate.surfaceId === target.surfaceId,
  );
  if (!surface) return null;
  if (
    target.actionId !== undefined &&
    !surfaceActionIds(surface).has(target.actionId)
  ) {
    return null;
  }
  return target.actionId === undefined
    ? { surface }
    : { surface, actionId: target.actionId };
}

export function surfaceActionIds(surface: UiSurface): Set<string> {
  const ids = new Set(surface.actions.map((action) => action.actionId));
  collectNodeActions(surface.nodes, (action) => ids.add(action.actionId));
  return ids;
}

export function referencedActionIds(nodes: readonly UiNode[]): Set<string> {
  const ids = new Set<string>();
  collectNodeActions(nodes, (action) => ids.add(action.actionId));
  return ids;
}

export function embeddedActionIds(nodes: readonly UiNode[]): Set<string> {
  const ids = new Set<string>();
  collectNodeActions(nodes, (action, kind) => {
    if (kind !== 'action-list') ids.add(action.actionId);
  });
  return ids;
}

function orderedSurfaces(surfaces: readonly UiSurface[]): UiSurface[] {
  return [...surfaces].sort(
    (left, right) =>
      left.order - right.order ||
      left.title.localeCompare(right.title) ||
      left.surfaceId.localeCompare(right.surfaceId),
  );
}

function collectNodeActions(
  nodes: readonly UiNode[],
  visit: (action: UiAction, kind: UiNode['kind']) => void,
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'navigation':
      case 'status-summary':
      case 'metrics':
      case 'text':
      case 'link':
      case 'detail':
      case 'progress':
      case 'log':
      case 'log-stream':
        break;
      case 'tabs':
        for (const tab of node.tabs) collectNodeActions(tab.nodes, visit);
        break;
      case 'list':
        for (const item of node.items) {
          if (item.action) visit(item.action, node.kind);
        }
        break;
      case 'table':
        for (const row of node.rows) {
          if (row.action) visit(row.action, node.kind);
        }
        break;
      case 'form':
        visit(node.submit, node.kind);
        break;
      case 'action-list':
        for (const action of node.actions) visit(action, node.kind);
        break;
      case 'command':
        visit(node.action, node.kind);
        break;
      case 'empty':
      case 'error':
        visit(node.action, node.kind);
        break;
      default:
        assertNever(node);
    }
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled ui.surface.v1 arm: ${JSON.stringify(value)}`);
}
