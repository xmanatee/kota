/**
 * Typed vocabulary of render-tree primitives. The rendering module
 * exposes these as the only shape operators pass to the renderer. A
 * discriminated union keeps exhaustiveness checks honest and prevents
 * arbitrary strings from sneaking around the theme/width pipeline.
 *
 * New primitives extend this union. Surfaces that cannot be modeled with
 * the current primitives should add one here, not reach around the
 * module with a raw console call. Convenience constructors live in
 * `primitive-ctors.ts` so this file stays focused on the type contract.
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

export type TextNode = { kind: "text"; spans: TextSpan[] };
export type LineNode = { kind: "line"; spans: TextSpan[] };
export type HeadingNode = { kind: "heading"; label: string; level: 1 | 2 | 3 };
export type SeparatorNode = { kind: "separator" };
export type SectionRuleNode = { kind: "sectionRule"; label: string };
export type BlankNode = { kind: "blank" };
export type StackNode = { kind: "stack"; children: RenderNode[] };

export type KVEntry = { label: string; value: string; role?: SemanticRole };
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

export type ListItem = { spans: TextSpan[]; children?: RenderNode[] };
export type ListNode = { kind: "list"; items: ListItem[]; ordered?: boolean };

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

export type DiffNode = { kind: "diff"; patch: string };
export type JsonNode = { kind: "json"; value: unknown; label?: string };

export type ColumnSpec = {
  header?: string;
  align?: "left" | "right";
  minWidth?: number;
  maxWidth?: number;
  role?: SemanticRole;
  headerRole?: SemanticRole;
};

export type ColumnCell = { spans: TextSpan[] };
export type ColumnRow = { cells: ColumnCell[]; role?: SemanticRole };
export type ColumnsNode = {
  kind: "columns";
  columns: ColumnSpec[];
  rows: ColumnRow[];
};

export type GroupNode = {
  kind: "group";
  label: string;
  role?: SemanticRole;
  body: RenderNode;
};

export type ProseNode = { kind: "prose"; text: string; role?: SemanticRole };

export type DashboardSection = {
  title: string;
  role?: SemanticRole;
  body: RenderNode;
};
export type DashboardNode = { kind: "dashboard"; sections: DashboardSection[] };

export type SpinnerNode = {
  kind: "spinner";
  label: string;
  status?: StatusKind;
  tick?: number;
};

export type ProgressNode = {
  kind: "progress";
  label: string;
  current: number;
  total: number;
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
  | JsonNode
  | ColumnsNode
  | GroupNode
  | ProseNode
  | DashboardNode
  | SpinnerNode
  | ProgressNode;

export {
  agentMessage,
  blank,
  columns,
  dashboard,
  diff,
  group,
  heading,
  json,
  kvBlock,
  line,
  list,
  panel,
  plain,
  progress,
  prose,
  sectionRule,
  separator,
  span,
  spinner,
  stack,
  statusBanner,
  text,
  toolCall,
} from "./primitive-ctors.js";
