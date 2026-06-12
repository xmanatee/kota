export type UiIntent = "Status" | "Inbox" | "Work" | "Knowledge" | "Setup";
export type UiRole = "neutral" | "info" | "success" | "warn" | "error" | "muted";
export type UiActionEffect = "read" | "write" | "external";
export type UiConfirmation = "none" | "required";

export type UiAction = {
  surfaceId: string;
  actionId: string;
  scopeId: string;
  label: string;
  effect: UiActionEffect;
  confirmation: UiConfirmation;
  command: string;
};

export type UiStatusEntry = {
  label: string;
  value: string;
  role: UiRole;
};

export type UiListItem = {
  id: string;
  title: string;
  detail: string;
  role: UiRole;
  action: UiAction;
};

export type UiFormField = {
  id: string;
  label: string;
  input: "text" | "secret" | "number" | "boolean";
  required: boolean;
};

export type UiNode =
  | { kind: "navigation"; label: string; items: Array<{ surfaceId: string; label: string }> }
  | { kind: "status-summary"; entries: UiStatusEntry[] }
  | { kind: "list"; title: string; items: UiListItem[] }
  | { kind: "detail"; title: string; body: string }
  | { kind: "form"; title: string; fields: UiFormField[]; submit: UiAction }
  | { kind: "command"; action: UiAction }
  | { kind: "empty"; title: string; detail: string; action: UiAction }
  | { kind: "error"; title: string; detail: string; action: UiAction };

export type UiSurface = {
  protocolVersion: "ui.surface.v1";
  surfaceId: string;
  title: string;
  intent: UiIntent;
  scopeId: string;
  nodes: UiNode[];
  actions: UiAction[];
};

export type UiSurfaceBundle = {
  protocolVersion: "ui.surface.v1";
  surfaces: UiSurface[];
};
