import type {
  UiNode,
  UiSurface,
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";

function nodeHasLogStream(node: UiNode): boolean {
  if (node.kind === "log-stream") return true;
  if (node.kind === "tabs") return node.tabs.some((tab) => tab.nodes.some((child) => nodeHasLogStream(child)));
  return false;
}

export function surfaceWithLogStream(bundle: UiSurfaceBundle): UiSurface | null {
  return bundle.surfaces.find((surface) => surface.nodes.some((node) => nodeHasLogStream(node))) ?? null;
}

function collectNodeEventTypes(node: UiNode, out: Set<string>): void {
  if (node.kind === "log-stream") {
    for (const eventType of node.source.eventTypes) out.add(eventType);
    return;
  }
  if (node.kind === "tabs") {
    for (const tab of node.tabs) {
      for (const child of tab.nodes) collectNodeEventTypes(child, out);
    }
  }
}

export function collectLiveEventTypes(bundle: UiSurfaceBundle): string[] {
  const eventTypes = new Set<string>();
  for (const surface of bundle.surfaces) {
    for (const node of surface.nodes) collectNodeEventTypes(node, eventTypes);
  }
  return [...eventTypes].sort();
}
