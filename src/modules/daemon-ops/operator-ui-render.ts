import {
  blank,
  columns,
  heading,
  kvBlock,
  line,
  list,
  plain,
  progress,
  prose,
  type RenderNode,
  sectionRule,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import type { UiAction, UiNode, UiSurface } from "./operator-ui-types.js";

function operationLabel(action: UiAction): string {
  if (action.operation.kind === "daemon-route") {
    return `${action.operation.method} ${action.operation.path}`;
  }
  return `${action.operation.namespace}.${action.operation.method}`;
}

function actionLine(action: UiAction): RenderNode {
  return line(
    span(action.label, "accent"),
    plain("  "),
    span(action.effect, action.effect === "read" ? "muted" : "warn"),
    plain("  "),
    span(action.confirmation.mode, action.confirmation.mode === "required" ? "warn" : "muted"),
    plain("  "),
    span(action.readiness.state, action.readiness.state === "ready" ? "success" : "warn"),
    plain("  "),
    span(operationLabel(action), "muted"),
  );
}

function linkTargetLabel(node: Extract<UiNode, { kind: "link" }>): string {
  if (node.target.kind === "surface") return `surface:${node.target.surfaceId}`;
  if (node.target.kind === "daemon-route") return node.target.path;
  return node.target.url;
}

function logLevelRole(level: "debug" | "info" | "warn" | "error"): "muted" | "info" | "warn" | "error" {
  if (level === "debug") return "muted";
  return level;
}

function renderNode(node: UiNode): RenderNode {
  switch (node.kind) {
    case "navigation":
      return stack(
        sectionRule(node.label),
        list(node.items.map((item) => ({
          spans: [span(item.surfaceId, "accent"), plain("  "), plain(item.label)],
        }))),
      );
    case "status-summary":
      return kvBlock(node.entries.map((entry) => ({
        label: entry.label,
        value: entry.value,
        role: entry.role,
      })));
    case "metrics":
      return stack(
        sectionRule(node.title),
        kvBlock(node.metrics.map((metric) => ({
          label: metric.label,
          value: metric.unit ? `${metric.value} ${metric.unit}` : metric.value,
          role: metric.role,
        }))),
      );
    case "text":
      return stack(sectionRule(node.title), prose(node.body, node.role));
    case "link":
      return line(span(node.label, node.role ?? "accent"), plain("  "), span(linkTargetLabel(node), "muted"));
    case "tabs":
      return stack(
        sectionRule(node.title),
        ...node.tabs.map((tab) =>
          stack(
            line(span(tab.id === node.activeTabId ? `* ${tab.label}` : `  ${tab.label}`, tab.id === node.activeTabId ? "accent" : "muted")),
            ...tab.nodes.map(renderNode),
          )
        ),
      );
    case "list":
      if (node.items.length === 0) {
        return stack(sectionRule(node.title), line(span("No items.", "muted")));
      }
      return stack(
        sectionRule(node.title),
        list(node.items.map((item) => ({
          spans: [
            span(item.title, item.role),
            plain("  "),
            span(item.detail, "muted"),
          ],
          children: item.action ? [line(span(operationLabel(item.action), "muted"))] : undefined,
        }))),
      );
    case "table":
      return stack(
        sectionRule(node.title),
        columns(
          node.columns.map((column) => ({
            header: column.label,
            role: column.role,
            headerRole: "muted",
            minWidth: 10,
            maxWidth: 32,
          })),
          node.rows.map((row) => ({
            cells: node.columns.map((column) => {
              const cell = row.cells.find((candidate) => candidate.columnId === column.id);
              return { spans: [span(cell?.value ?? "", cell?.role ?? column.role)] };
            }),
          })),
        ),
      );
    case "detail":
      return stack(sectionRule(node.title), line(plain(node.body)));
    case "progress":
      return progress(node.label, node.value, node.max);
    case "log":
      return stack(
        sectionRule(node.title),
        list(node.entries.map((entry) => ({
          spans: [
            span(entry.timestamp, "muted"),
            plain("  "),
            span(entry.level, logLevelRole(entry.level)),
            plain("  "),
            entry.source ? span(`${entry.source}: `, "muted") : plain(""),
            plain(entry.message),
          ],
        }))),
      );
    case "log-stream":
      return stack(
        sectionRule(node.title),
        line(span(`${node.source.kind} ${node.source.path}`, "muted")),
        list(node.entries.map((entry) => ({
          spans: [
            span(entry.timestamp, "muted"),
            plain("  "),
            span(entry.level, logLevelRole(entry.level)),
            plain("  "),
            entry.source ? span(`${entry.source}: `, "muted") : plain(""),
            plain(entry.message),
          ],
        }))),
      );
    case "form":
      return stack(
        sectionRule(node.title),
        list(node.fields.map((field) => ({
          spans: [
            span(field.label, "accent"),
            plain("  "),
            span(field.input, "muted"),
            plain(field.required ? " required" : ""),
          ],
        }))),
        actionLine(node.submit),
      );
    case "action-list":
      return stack(sectionRule(node.title), ...node.actions.map(actionLine));
    case "command":
      return actionLine(node.action);
    case "empty":
      return statusBanner("success", node.title, node.detail);
    case "error":
      return statusBanner("error", node.title, `${node.detail} (${operationLabel(node.action)})`);
  }
}

export function renderUiSurface(surface: UiSurface): RenderNode {
  return stack(
    heading(surface.title, 1),
    line(span(surface.intent, "muted")),
    blank(),
    ...surface.nodes.map(renderNode),
  );
}
