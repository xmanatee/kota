import {
  blank,
  heading,
  kvBlock,
  line,
  list,
  plain,
  type RenderNode,
  sectionRule,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import type { UiNode, UiSurface } from "./operator-ui-types.js";

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
          children: [line(span(item.action.command, "muted"))],
        }))),
      );
    case "detail":
      return stack(sectionRule(node.title), line(plain(node.body)));
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
        line(span(node.submit.command, "muted")),
      );
    case "command":
      return line(span(node.action.command, "accent"));
    case "empty":
      return statusBanner("success", node.title, node.detail);
    case "error":
      return statusBanner("error", node.title, `${node.detail} (${node.action.command})`);
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
