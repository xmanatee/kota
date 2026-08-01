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
  type SemanticRole,
  sectionRule,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import {
  safeTerminalLineText,
  stripTerminalTextControls,
} from "#modules/rendering/safe-terminal-text.js";
import type { UiAction, UiNode, UiSurface } from "./operator-ui-types.js";

function terminalSpan(text: string, role?: SemanticRole) {
  return span(safeTerminalLineText(text), role);
}

function terminalPlain(text: string) {
  return plain(safeTerminalLineText(text));
}

function operationLabel(action: UiAction): string {
  if (action.operation.kind === "daemon-route") {
    return `${action.operation.method} ${action.operation.path}`;
  }
  return `${action.operation.namespace}.${action.operation.method}`;
}

function actionLine(action: UiAction): RenderNode {
  return line(
    terminalSpan(action.label, "accent"),
    plain("  "),
    terminalSpan(action.effect, action.effect === "read" ? "muted" : "warn"),
    plain("  "),
    terminalSpan(action.confirmation.mode, action.confirmation.mode === "required" ? "warn" : "muted"),
    plain("  "),
    terminalSpan(action.readiness.state, action.readiness.state === "ready" ? "success" : "warn"),
    plain("  "),
    terminalSpan(operationLabel(action), "muted"),
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
        sectionRule(safeTerminalLineText(node.label)),
        list(node.items.map((item) => ({
          spans: [terminalSpan(item.surfaceId, "accent"), plain("  "), terminalPlain(item.label)],
        }))),
      );
    case "status-summary":
      return kvBlock(node.entries.map((entry) => ({
        label: safeTerminalLineText(entry.label),
        value: safeTerminalLineText(entry.value),
        role: entry.role,
      })));
    case "metrics":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        kvBlock(node.metrics.map((metric) => ({
          label: safeTerminalLineText(metric.label),
          value: safeTerminalLineText(metric.unit ? `${metric.value} ${metric.unit}` : metric.value),
          role: metric.role,
        }))),
      );
    case "text":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        prose(stripTerminalTextControls(node.body), node.role),
      );
    case "link":
      return line(
        terminalSpan(node.label, node.role ?? "accent"),
        plain("  "),
        terminalSpan(linkTargetLabel(node), "muted"),
      );
    case "tabs":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        ...node.tabs.map((tab) =>
          stack(
            line(terminalSpan(
              tab.id === node.activeTabId ? `* ${tab.label}` : `  ${tab.label}`,
              tab.id === node.activeTabId ? "accent" : "muted",
            )),
            ...tab.nodes.map(renderNode),
          )
        ),
      );
    case "list":
      if (node.items.length === 0) {
        return stack(sectionRule(safeTerminalLineText(node.title)), line(span("No items.", "muted")));
      }
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        list(node.items.map((item) => ({
          spans: [
            terminalSpan(item.title, item.role),
            plain("  "),
            terminalSpan(item.detail, "muted"),
          ],
          children: item.action ? [line(terminalSpan(operationLabel(item.action), "muted"))] : undefined,
        }))),
      );
    case "table":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        columns(
          node.columns.map((column) => ({
            header: safeTerminalLineText(column.label),
            role: column.role,
            headerRole: "muted",
            minWidth: 10,
            maxWidth: 32,
          })),
          node.rows.map((row) => ({
            cells: node.columns.map((column) => {
              const cell = row.cells.find((candidate) => candidate.columnId === column.id);
              const rowAction = row.action && column.id === node.columns[node.columns.length - 1]?.id
                ? `  ${row.action.label}: ${operationLabel(row.action)}`
                : "";
              return {
                spans: [terminalSpan(`${cell?.value ?? ""}${rowAction}`, cell?.role ?? column.role)],
              };
            }),
          })),
        ),
      );
    case "detail":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        line(terminalPlain(node.body)),
      );
    case "progress":
      return progress(safeTerminalLineText(node.label), node.value, node.max);
    case "log":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        list(node.entries.map((entry) => ({
          spans: [
            terminalSpan(entry.timestamp, "muted"),
            plain("  "),
            terminalSpan(entry.level, logLevelRole(entry.level)),
            plain("  "),
            entry.source ? terminalSpan(`${entry.source}: `, "muted") : plain(""),
            terminalPlain(entry.message),
          ],
        }))),
      );
    case "log-stream":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        line(terminalSpan(`${node.source.kind} ${node.source.path}`, "muted")),
        list(node.entries.map((entry) => ({
          spans: [
            terminalSpan(entry.timestamp, "muted"),
            plain("  "),
            terminalSpan(entry.level, logLevelRole(entry.level)),
            plain("  "),
            entry.source ? terminalSpan(`${entry.source}: `, "muted") : plain(""),
            terminalPlain(entry.message),
          ],
        }))),
      );
    case "form":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        list(node.fields.map((field) => ({
          spans: [
            terminalSpan(field.label, "accent"),
            plain("  "),
            terminalSpan(field.input, "muted"),
            plain(field.required ? " required" : ""),
          ],
        }))),
        actionLine(node.submit),
      );
    case "action-list":
      return stack(
        sectionRule(safeTerminalLineText(node.title)),
        ...node.actions.map(actionLine),
      );
    case "command":
      return actionLine(node.action);
    case "empty":
      return statusBanner(
        "success",
        safeTerminalLineText(node.title),
        safeTerminalLineText(node.detail),
      );
    case "error":
      return statusBanner(
        "error",
        safeTerminalLineText(node.title),
        safeTerminalLineText(`${node.detail} (${operationLabel(node.action)})`),
      );
  }
}

export function renderUiSurface(surface: UiSurface): RenderNode {
  return stack(
    heading(safeTerminalLineText(surface.title), 1),
    line(terminalSpan(surface.intent, "muted")),
    blank(),
    ...surface.nodes.map(renderNode),
  );
}
