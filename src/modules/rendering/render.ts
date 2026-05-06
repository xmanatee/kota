import type { RenderNode } from "./primitives.js";
import {
  renderAgentMessage,
  renderDiff,
  renderHeading,
  renderJson,
  renderKVBlock,
  renderList,
  renderPanel,
  renderStatusBanner,
  renderToolCall,
} from "./render-blocks.js";
import { pad, paintSpan, paintSpans, type RenderContext, renderContext } from "./render-paint.js";
import {
  renderColumns,
  renderDashboard,
  renderGroup,
  renderProgress,
  renderProse,
  renderSpinner,
} from "./render-rich.js";

export type { RenderContext } from "./render-paint.js";
export { renderContext } from "./render-paint.js";

/**
 * Pure renderer dispatch. Each `case` delegates to a handler in
 * `render-blocks.ts` (original primitives) or `render-rich.ts` (richer
 * column/group/prose/dashboard/spinner/progress primitives). The
 * dispatch lives here so the discriminated union has a single place
 * the compiler exhaustiveness-checks against.
 */
export function renderNode(node: RenderNode, ctx: RenderContext): string {
  switch (node.kind) {
    case "text":
    case "line":
      return `${pad(ctx.indent)}${paintSpans(node.spans, ctx.theme)}`;
    case "heading":
      return renderHeading(node, ctx);
    case "separator": {
      const len = Math.max(4, ctx.width - ctx.indent);
      return `${pad(ctx.indent)}${ctx.theme.separatorRule.repeat(len)}`;
    }
    case "sectionRule": {
      const prefix = pad(ctx.indent);
      const labelSpan = paintSpan({ text: node.label, bold: true }, ctx.theme);
      const remaining = Math.max(0, ctx.width - ctx.indent - node.label.length - 1);
      if (remaining === 0) return `${prefix}${labelSpan}`;
      const rule = ctx.theme.separatorRule.repeat(remaining);
      const ruleSpan = paintSpan({ text: rule, role: "muted" }, ctx.theme);
      return `${prefix}${labelSpan} ${ruleSpan}`;
    }
    case "blank":
      return "";
    case "stack":
      return node.children.map((c) => renderNode(c, ctx)).join("\n");
    case "kvBlock":
      return renderKVBlock(node, ctx);
    case "statusBanner":
      return renderStatusBanner(node, ctx);
    case "list":
      return renderList(node, ctx);
    case "panel":
      return renderPanel(node, ctx);
    case "toolCall":
      return renderToolCall(node, ctx);
    case "agentMessage":
      return renderAgentMessage(node, ctx);
    case "diff":
      return renderDiff(node, ctx);
    case "json":
      return renderJson(node, ctx);
    case "columns":
      return renderColumns(node, ctx);
    case "group":
      return renderGroup(node, ctx);
    case "prose":
      return renderProse(node, ctx);
    case "dashboard":
      return renderDashboard(node, ctx);
    case "spinner":
      return renderSpinner(node, ctx);
    case "progress":
      return renderProgress(node, ctx);
  }
}

/**
 * Pure render entry point. Callers pass a RenderNode plus a context
 * built by the transport (or constructed by hand for tests) and receive
 * the exact string the transport would write.
 */
export function render(node: RenderNode, ctx?: Partial<RenderContext>): string {
  return renderNode(node, renderContext(ctx));
}
