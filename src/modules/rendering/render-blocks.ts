/**
 * Renderers for the original block primitives. Splitting these out
 * keeps `render.ts` focused on dispatch and keeps each per-primitive
 * function readable. Recursive primitives (panel, list, agentMessage)
 * import `renderNode` from `render.ts`; the cycle is fine because the
 * import is only used at call time.
 */

import type {
  AgentMessageNode,
  DiffNode,
  HeadingNode,
  JsonNode,
  KVBlockNode,
  ListItem,
  ListNode,
  PanelNode,
  StatusBannerNode,
  TextSpan,
  ToolCallNode,
} from "./primitives.js";
import { renderNode } from "./render.js";
import { pad, paintSpan, paintSpans, type RenderContext, statusRole } from "./render-paint.js";

export function renderHeading(node: HeadingNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  const label =
    ctx.theme.supportsAnsi && node.level === 1
      ? `${ctx.theme.bold.open}${node.label}\x1b[0m`
      : node.label;
  if (node.level === 1) {
    const ruleLen = Math.max(4, Math.min(ctx.width - ctx.indent, 40));
    const rule = ctx.theme.headingRule.repeat(ruleLen);
    return `${prefix}${label}\n${prefix}${rule}`;
  }
  return `${prefix}${label}`;
}

export function renderKVBlock(node: KVBlockNode, ctx: RenderContext): string {
  const maxLabel = node.entries.reduce((acc, e) => Math.max(acc, e.label.length), 0);
  const columnWidth = (node.labelWidth ?? maxLabel) + 1;
  const prefix = pad(ctx.indent);
  return node.entries
    .map((e) => {
      const label = `${e.label}:`.padEnd(columnWidth);
      const valueSpan: TextSpan = e.role ? { text: e.value, role: e.role } : { text: e.value };
      return `${prefix}${label} ${paintSpan(valueSpan, ctx.theme)}`;
    })
    .join("\n");
}

export function renderStatusBanner(node: StatusBannerNode, ctx: RenderContext): string {
  const style = ctx.theme.status[node.status];
  const spans: TextSpan[] = [
    { text: `${style.icon} ${style.label} `, role: statusRole(node.status), bold: true },
    { text: node.message },
  ];
  const head = `${pad(ctx.indent)}${paintSpans(spans, ctx.theme)}`;
  if (!node.detail) return head;
  const detailPrefix = pad(ctx.indent + 2);
  return `${head}\n${detailPrefix}${paintSpan({ text: node.detail, role: "muted" }, ctx.theme)}`;
}

export function renderList(node: ListNode, ctx: RenderContext): string {
  const lines: string[] = [];
  const prefix = pad(ctx.indent);
  node.items.forEach((item: ListItem, i: number) => {
    const bullet = node.ordered ? `${i + 1}.` : "-";
    lines.push(`${prefix}${bullet} ${paintSpans(item.spans, ctx.theme)}`);
    if (item.children) {
      for (const child of item.children) {
        lines.push(renderNode(child, { ...ctx, indent: ctx.indent + 2 }));
      }
    }
  });
  return lines.join("\n");
}

export function renderPanel(node: PanelNode, ctx: RenderContext): string {
  const innerWidth = Math.max(4, ctx.width - ctx.indent - 4);
  const innerCtx: RenderContext = { ...ctx, indent: 0, width: innerWidth };
  const bodyText = renderNode(node.body, innerCtx);
  const prefix = pad(ctx.indent);
  const rule = "─".repeat(innerWidth);
  const topLabel = node.title ?? "";
  const title = node.title
    ? `${prefix}┌─ ${paintSpan({ text: topLabel, role: node.role, bold: true }, ctx.theme)} ${"─".repeat(Math.max(0, innerWidth - topLabel.length - 4))}┐`
    : `${prefix}┌${rule}┐`;
  const bodyLines = bodyText.split("\n").map((l) => `${prefix}│ ${l}`);
  const bottom = `${prefix}└${rule}┘`;
  return [title, ...bodyLines, bottom].join("\n");
}

export function renderToolCall(node: ToolCallNode, ctx: RenderContext): string {
  const style = ctx.theme.status[node.status];
  const prefix = pad(ctx.indent);
  const head = `${prefix}${paintSpan({ text: `${style.icon} tool:`, role: "tool", bold: true }, ctx.theme)} ${paintSpan({ text: node.tool, role: "tool" }, ctx.theme)}${node.summary ? `  ${paintSpan({ text: node.summary, role: "muted" }, ctx.theme)}` : ""}`;
  const lines = [head];
  if (node.args) {
    lines.push(`${pad(ctx.indent + 2)}${paintSpan({ text: `args: ${node.args}`, role: "muted" }, ctx.theme)}`);
  }
  if (node.result) {
    lines.push(`${pad(ctx.indent + 2)}${paintSpan({ text: node.result, role: statusRole(node.status) }, ctx.theme)}`);
  }
  return lines.join("\n");
}

export function renderAgentMessage(node: AgentMessageNode, ctx: RenderContext): string {
  const roleRole = node.role === "assistant" ? "agent" : node.role === "system" ? "muted" : "accent";
  const head = `${pad(ctx.indent)}${paintSpan({ text: `[${node.role}]`, role: roleRole, bold: true }, ctx.theme)}`;
  const body = renderNode(node.body, { ...ctx, indent: ctx.indent + 2 });
  return `${head}\n${body}`;
}

export function renderDiff(node: DiffNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  return node.patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return `${prefix}${paintSpan({ text: line, role: "success" }, ctx.theme)}`;
      if (line.startsWith("-")) return `${prefix}${paintSpan({ text: line, role: "error" }, ctx.theme)}`;
      if (line.startsWith("@@")) return `${prefix}${paintSpan({ text: line, role: "accent" }, ctx.theme)}`;
      return `${prefix}${line}`;
    })
    .join("\n");
}

export function renderJson(node: JsonNode, ctx: RenderContext): string {
  const label = node.label ? `${pad(ctx.indent)}${paintSpan({ text: node.label, role: "muted" }, ctx.theme)}\n` : "";
  const body = JSON.stringify(node.value, null, 2)
    .split("\n")
    .map((l) => `${pad(ctx.indent)}${l}`)
    .join("\n");
  return `${label}${body}`;
}
