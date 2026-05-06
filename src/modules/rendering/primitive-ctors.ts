/**
 * Convenience constructors for the primitive vocabulary. Each helper
 * builds one node of the discriminated union with the small ergonomic
 * shorthand surfaces use most. Types live in `primitives.ts`; the
 * split keeps that file focused on the type contract.
 */

import type {
  AgentMessageNode,
  BlankNode,
  ColumnRow,
  ColumnSpec,
  ColumnsNode,
  DashboardNode,
  DashboardSection,
  DiffNode,
  GroupNode,
  HeadingNode,
  JsonNode,
  KVBlockNode,
  KVEntry,
  LineNode,
  ListItem,
  ListNode,
  PanelNode,
  ProgressNode,
  ProseNode,
  RenderNode,
  SectionRuleNode,
  SemanticRole,
  SeparatorNode,
  SpinnerNode,
  StackNode,
  StatusBannerNode,
  StatusKind,
  TextNode,
  TextSpan,
  ToolCallNode,
} from "./primitives.js";

export function stack(...children: RenderNode[]): StackNode {
  return { kind: "stack", children };
}

export function line(...spans: TextSpan[]): LineNode {
  return { kind: "line", spans };
}

export function text(...spans: TextSpan[]): TextNode {
  return { kind: "text", spans };
}

export function span(textValue: string, role?: SemanticRole, bold?: boolean): TextSpan {
  const result: TextSpan = { text: textValue };
  if (role !== undefined) result.role = role;
  if (bold !== undefined) result.bold = bold;
  return result;
}

export function plain(textValue: string): TextSpan {
  return { text: textValue };
}

export function heading(label: string, level: 1 | 2 | 3 = 2): HeadingNode {
  return { kind: "heading", label, level };
}

export function separator(): SeparatorNode {
  return { kind: "separator" };
}

export function sectionRule(label: string): SectionRuleNode {
  return { kind: "sectionRule", label };
}

export function blank(): BlankNode {
  return { kind: "blank" };
}

export function kvBlock(entries: KVEntry[], labelWidth?: number): KVBlockNode {
  if (labelWidth !== undefined) return { kind: "kvBlock", entries, labelWidth };
  return { kind: "kvBlock", entries };
}

export function statusBanner(
  status: StatusKind,
  message: string,
  detail?: string,
): StatusBannerNode {
  const node: StatusBannerNode = { kind: "statusBanner", status, message };
  if (detail !== undefined) node.detail = detail;
  return node;
}

export function list(items: ListItem[], ordered?: boolean): ListNode {
  if (ordered !== undefined) return { kind: "list", items, ordered };
  return { kind: "list", items };
}

export function panel(
  body: RenderNode,
  opts?: { title?: string; role?: SemanticRole },
): PanelNode {
  const node: PanelNode = { kind: "panel", body };
  if (opts?.title !== undefined) node.title = opts.title;
  if (opts?.role !== undefined) node.role = opts.role;
  return node;
}

export function toolCall(
  tool: string,
  status: StatusKind,
  opts?: { summary?: string; args?: string; result?: string },
): ToolCallNode {
  const node: ToolCallNode = { kind: "toolCall", tool, status };
  if (opts?.summary !== undefined) node.summary = opts.summary;
  if (opts?.args !== undefined) node.args = opts.args;
  if (opts?.result !== undefined) node.result = opts.result;
  return node;
}

export function agentMessage(
  role: AgentMessageNode["role"],
  body: RenderNode,
): AgentMessageNode {
  return { kind: "agentMessage", role, body };
}

export function diff(patch: string): DiffNode {
  return { kind: "diff", patch };
}

export function json(value: unknown, label?: string): JsonNode {
  if (label !== undefined) return { kind: "json", value, label };
  return { kind: "json", value };
}

export function columns(
  columnSpecs: ColumnSpec[],
  rows: ColumnRow[],
): ColumnsNode {
  return { kind: "columns", columns: columnSpecs, rows };
}

export function group(
  label: string,
  body: RenderNode,
  role?: SemanticRole,
): GroupNode {
  const node: GroupNode = { kind: "group", label, body };
  if (role !== undefined) node.role = role;
  return node;
}

export function prose(textValue: string, role?: SemanticRole): ProseNode {
  const node: ProseNode = { kind: "prose", text: textValue };
  if (role !== undefined) node.role = role;
  return node;
}

export function dashboard(sections: DashboardSection[]): DashboardNode {
  return { kind: "dashboard", sections };
}

export function spinner(
  label: string,
  opts?: { status?: StatusKind; tick?: number },
): SpinnerNode {
  const node: SpinnerNode = { kind: "spinner", label };
  if (opts?.status !== undefined) node.status = opts.status;
  if (opts?.tick !== undefined) node.tick = opts.tick;
  return node;
}

export function progress(label: string, current: number, total: number): ProgressNode {
  return { kind: "progress", label, current, total };
}
