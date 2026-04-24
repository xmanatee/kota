/**
 * Typed vocabulary of render-tree primitives. The rendering module
 * exposes these as the only shape operators pass to the renderer. A
 * discriminated union keeps exhaustiveness checks honest and prevents
 * arbitrary strings from sneaking around the theme/width pipeline.
 *
 * New primitives extend this union. Surfaces that cannot be modeled with
 * the current primitives should add one here, not reach around the
 * module with a raw console call.
 */

export type SemanticRole =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "error"
  | "muted"
  | "accent"
  | "tool"
  | "agent";

export type StatusKind = "success" | "error" | "warn" | "info" | "pending";

export type TextSpan = {
  text: string;
  role?: SemanticRole;
  bold?: boolean;
};

export type TextNode = {
  kind: "text";
  spans: TextSpan[];
};

export type LineNode = {
  kind: "line";
  spans: TextSpan[];
};

export type HeadingNode = {
  kind: "heading";
  label: string;
  level: 1 | 2 | 3;
};

export type SeparatorNode = {
  kind: "separator";
};

export type SectionRuleNode = {
  kind: "sectionRule";
  label: string;
};

export type BlankNode = {
  kind: "blank";
};

export type StackNode = {
  kind: "stack";
  children: RenderNode[];
};

export type KVEntry = {
  label: string;
  value: string;
  role?: SemanticRole;
};

export type KVBlockNode = {
  kind: "kvBlock";
  entries: KVEntry[];
  labelWidth?: number;
};

export type StatusBannerNode = {
  kind: "statusBanner";
  status: StatusKind;
  message: string;
  detail?: string;
};

export type ListItem = {
  spans: TextSpan[];
  children?: RenderNode[];
};

export type ListNode = {
  kind: "list";
  items: ListItem[];
  ordered?: boolean;
};

export type PanelNode = {
  kind: "panel";
  title?: string;
  role?: SemanticRole;
  body: RenderNode;
};

export type ToolCallNode = {
  kind: "toolCall";
  tool: string;
  summary?: string;
  args?: string;
  result?: string;
  status: StatusKind;
};

export type AgentMessageNode = {
  kind: "agentMessage";
  role: "user" | "assistant" | "system";
  body: RenderNode;
};

export type DiffNode = {
  kind: "diff";
  patch: string;
};

export type JsonNode = {
  kind: "json";
  value: unknown;
  label?: string;
};

export type RenderNode =
  | TextNode
  | LineNode
  | HeadingNode
  | SeparatorNode
  | SectionRuleNode
  | BlankNode
  | StackNode
  | KVBlockNode
  | StatusBannerNode
  | ListNode
  | PanelNode
  | ToolCallNode
  | AgentMessageNode
  | DiffNode
  | JsonNode;

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
  if (labelWidth !== undefined) {
    return { kind: "kvBlock", entries, labelWidth };
  }
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

export function panel(body: RenderNode, opts?: { title?: string; role?: SemanticRole }): PanelNode {
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
