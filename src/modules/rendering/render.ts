import type {
  AgentMessageNode,
  DiffNode,
  HeadingNode,
  JsonNode,
  KVBlockNode,
  ListItem,
  ListNode,
  PanelNode,
  RenderNode,
  StatusBannerNode,
  TextSpan,
  ToolCallNode,
} from "./primitives.js";
import { DEFAULT_THEME, type Theme } from "./theme.js";

/**
 * RenderContext is passed to the pure renderer. Transports build one per
 * render and do not mutate it. Width is clamped to a safe minimum so the
 * output remains readable even in narrow terminals and does not divide-
 * by-zero in box drawing math.
 */
export type RenderContext = {
  theme: Theme;
  width: number;
  indent: number;
};

const MIN_WIDTH = 20;

export function renderContext(partial?: Partial<RenderContext>): RenderContext {
  return {
    theme: partial?.theme ?? DEFAULT_THEME,
    width: Math.max(MIN_WIDTH, partial?.width ?? 80),
    indent: partial?.indent ?? 0,
  };
}

function pad(n: number): string {
  return n > 0 ? " ".repeat(n) : "";
}

function paintSpan(span: TextSpan, theme: Theme): string {
  if (!theme.supportsAnsi) return span.text;
  const roleAnsi = span.role ? theme.role[span.role] : undefined;
  const bold = span.bold ? theme.bold : undefined;
  const opens = `${bold?.open ?? ""}${roleAnsi?.open ?? ""}`;
  if (!opens) return span.text;
  return `${opens}${span.text}[0m`;
}

function paintSpans(spans: TextSpan[], theme: Theme): string {
  return spans.map((s) => paintSpan(s, theme)).join("");
}

function renderHeading(node: HeadingNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  const label =
    ctx.theme.supportsAnsi && node.level === 1
      ? `${ctx.theme.bold.open}${node.label}[0m`
      : node.label;
  if (node.level === 1) {
    const ruleLen = Math.max(4, Math.min(ctx.width - ctx.indent, 40));
    const rule = ctx.theme.headingRule.repeat(ruleLen);
    return `${prefix}${label}\n${prefix}${rule}`;
  }
  if (node.level === 2) {
    return `${prefix}${label}`;
  }
  return `${prefix}${label}`;
}

function renderKVBlock(node: KVBlockNode, ctx: RenderContext): string {
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

function renderStatusBanner(node: StatusBannerNode, ctx: RenderContext): string {
  const style = ctx.theme.status[node.status];
  const icon = style.icon;
  const label = style.label;
  const spans: TextSpan[] = [
    { text: `${icon} ${label} `, role: statusRole(node.status), bold: true },
    { text: node.message },
  ];
  const head = `${pad(ctx.indent)}${paintSpans(spans, ctx.theme)}`;
  if (!node.detail) return head;
  const detailPrefix = pad(ctx.indent + 2);
  return `${head}\n${detailPrefix}${paintSpan({ text: node.detail, role: "muted" }, ctx.theme)}`;
}

function statusRole(status: StatusBannerNode["status"]):
  | "success"
  | "error"
  | "warn"
  | "info"
  | "muted" {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
    case "pending":
      return "muted";
  }
}

function renderList(node: ListNode, ctx: RenderContext): string {
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

function renderPanel(node: PanelNode, ctx: RenderContext): string {
  const innerWidth = Math.max(4, ctx.width - ctx.indent - 4);
  const innerCtx: RenderContext = {
    ...ctx,
    indent: 0,
    width: innerWidth,
  };
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

function renderToolCall(node: ToolCallNode, ctx: RenderContext): string {
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

function renderAgentMessage(node: AgentMessageNode, ctx: RenderContext): string {
  const roleRole = node.role === "assistant" ? "agent" : node.role === "system" ? "muted" : "accent";
  const head = `${pad(ctx.indent)}${paintSpan({ text: `[${node.role}]`, role: roleRole, bold: true }, ctx.theme)}`;
  const body = renderNode(node.body, { ...ctx, indent: ctx.indent + 2 });
  return `${head}\n${body}`;
}

function renderDiff(node: DiffNode, ctx: RenderContext): string {
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

function renderJson(node: JsonNode, ctx: RenderContext): string {
  const label = node.label ? `${pad(ctx.indent)}${paintSpan({ text: node.label, role: "muted" }, ctx.theme)}\n` : "";
  const body = JSON.stringify(node.value, null, 2)
    .split("\n")
    .map((l) => `${pad(ctx.indent)}${l}`)
    .join("\n");
  return `${label}${body}`;
}

export function renderNode(node: RenderNode, ctx: RenderContext): string {
  switch (node.kind) {
    case "text":
      return `${pad(ctx.indent)}${paintSpans(node.spans, ctx.theme)}`;
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
      const remaining = Math.max(
        0,
        ctx.width - ctx.indent - node.label.length - 1,
      );
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
