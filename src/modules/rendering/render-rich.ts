/**
 * Renderers for the richer primitives that lift the module beyond the
 * original "lines + headings + key/value" vocabulary: aligned columns,
 * role-aware groups, width-aware prose, sectioned dashboards, and the
 * spinner / progress pair. Layout helpers live in `layout.ts` so the
 * fitting math is pure and unit-testable on its own.
 */

import {
  distributeColumnWidths,
  fitCellText,
  progressBar,
  spansVisibleLength,
  spinnerFrame,
  spinnerStaticGlyph,wrapProse 
} from "./layout.js";
import type {
  ColumnsNode,
  DashboardNode,
  GroupNode,
  ProgressNode,
  ProseNode,
  SemanticRole,
  SpinnerNode,
  StatusKind,
  TextSpan,
} from "./primitives.js";
import { renderNode } from "./render.js";
import { pad, paintSpan, type RenderContext, themeName } from "./render-paint.js";
import type { Theme } from "./theme.js";

export function renderColumns(node: ColumnsNode, ctx: RenderContext): string {
  if (node.columns.length === 0) return "";
  const headerRow = node.columns.some((c) => c.header !== undefined)
    ? {
        cells: node.columns.map((c) => ({
          spans: c.header
            ? [{ text: c.header, role: c.headerRole ?? "muted", bold: true } satisfies TextSpan]
            : [],
        })),
      }
    : null;
  const allRows = headerRow ? [headerRow, ...node.rows] : node.rows;
  const natural: number[] = node.columns.map((_, ci) => {
    let max = node.columns[ci]?.header?.length ?? 0;
    for (const row of node.rows) {
      const cell = row.cells[ci];
      if (cell) max = Math.max(max, spansVisibleLength(cell.spans));
    }
    return max;
  });
  const available = Math.max(4, ctx.width - ctx.indent);
  const widths = distributeColumnWidths(node.columns, natural, available);
  const prefix = pad(ctx.indent);
  return allRows
    .map((row, rowIdx) => {
      const isHeader = headerRow !== null && rowIdx === 0;
      const cells = row.cells.map((cell, ci) => {
        const spec = node.columns[ci]!;
        const width = widths[ci]!;
        const align = spec.align ?? "left";
        const visible = cell.spans.map((s) => s.text).join("");
        const fitted = fitCellText(visible, width, align);
        if (!ctx.theme.supportsAnsi) return fitted;
        return paintCellText(cell.spans, fitted, spec.role, ctx.theme, isHeader);
      });
      return `${prefix}${cells.join("  ")}`;
    })
    .join("\n");
}

function paintCellText(
  spans: TextSpan[],
  fitted: string,
  fallbackRole: SemanticRole | undefined,
  theme: Theme,
  bold: boolean,
): string {
  if (spans.length === 0) return fitted;
  if (spans.length === 1 && spans[0]!.text.length === fitted.length) {
    const only = spans[0]!;
    return paintSpan({ ...only, bold: bold || (only.bold ?? false) }, theme);
  }
  const role = spans[0]!.role ?? fallbackRole;
  const target: TextSpan = { text: fitted };
  if (role !== undefined) target.role = role;
  if (bold) target.bold = true;
  return paintSpan(target, theme);
}

export function renderGroup(node: GroupNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  const role = node.role ?? "accent";
  const labelSpan = paintSpan({ text: node.label, role, bold: true }, ctx.theme);
  const marker = ctx.theme.supportsAnsi
    ? paintSpan({ text: "▎", role }, ctx.theme)
    : "|";
  const head = `${prefix}${marker} ${labelSpan}`;
  const body = renderNode(node.body, { ...ctx, indent: ctx.indent + 2 });
  return `${head}\n${body}`;
}

export function renderProse(node: ProseNode, ctx: RenderContext): string {
  const targetWidth = Math.max(1, ctx.width - ctx.indent);
  const lines = wrapProse(node.text, targetWidth);
  const prefix = pad(ctx.indent);
  return lines
    .map((ln) => {
      if (!ln) return "";
      const span: TextSpan = { text: ln };
      if (node.role !== undefined) span.role = node.role;
      return `${prefix}${paintSpan(span, ctx.theme)}`;
    })
    .join("\n");
}

export function renderDashboard(node: DashboardNode, ctx: RenderContext): string {
  const blocks: string[] = [];
  node.sections.forEach((section, idx) => {
    if (idx > 0) {
      blocks.push("");
      blocks.push("");
    }
    const role = section.role ?? "accent";
    const labelSpan = paintSpan({ text: section.title, role, bold: true }, ctx.theme);
    const remaining = Math.max(0, ctx.width - ctx.indent - section.title.length - 1);
    const ruleChar = ctx.theme.separatorRule;
    const rule =
      remaining > 0
        ? ctx.theme.supportsAnsi
          ? paintSpan({ text: ruleChar.repeat(remaining), role: "muted" }, ctx.theme)
          : ruleChar.repeat(remaining)
        : "";
    const prefix = pad(ctx.indent);
    const head = remaining > 0 ? `${prefix}${labelSpan} ${rule}` : `${prefix}${labelSpan}`;
    blocks.push(head);
    const body = renderNode(section.body, { ...ctx, indent: ctx.indent + 2 });
    blocks.push(body);
  });
  return blocks.join("\n");
}

function statusRoleForSpinner(status: StatusKind | undefined): SemanticRole {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
    default:
      return "muted";
  }
}

export function renderSpinner(node: SpinnerNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  const tName = themeName(ctx.theme);
  const status: StatusKind = node.status ?? "pending";
  const role = statusRoleForSpinner(node.status);
  const glyph =
    status === "pending"
      ? node.tick !== undefined
        ? spinnerFrame(tName, node.tick)
        : spinnerStaticGlyph(tName)
      : ctx.theme.status[status].icon;
  const head = `${paintSpan({ text: glyph, role, bold: true }, ctx.theme)} ${paintSpan({ text: node.label }, ctx.theme)}`;
  return `${prefix}${head}`;
}

export function renderProgress(node: ProgressNode, ctx: RenderContext): string {
  const prefix = pad(ctx.indent);
  const tName = themeName(ctx.theme);
  const labelText = `${node.label} `;
  const counter = `  ${node.current}/${node.total}`;
  const reserved = labelText.length + counter.length + 2;
  const barWidth = Math.max(4, ctx.width - ctx.indent - reserved);
  const bar = progressBar(node.current, node.total, barWidth, tName);
  const role = node.current >= node.total ? "success" : "info";
  const barSpan = paintSpan({ text: bar, role }, ctx.theme);
  const counterSpan = paintSpan({ text: counter, role: "muted" }, ctx.theme);
  return `${prefix}${labelText}${barSpan}${counterSpan}`;
}
