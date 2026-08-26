import type {
  UiAction,
  UiActionEffect,
  UiActionOperation,
  UiActionParameterSpec,
  UiActionReadiness,
  UiActionResultSpec,
  UiCondition,
  UiConfirmation,
  UiPermission,
  UiRole,
  UiTableColumn,
  UiTableRow,
} from "./ui-surface.js";

type ActionArgs = {
  surfaceId: string;
  actionId: string;
  scopeId: string;
  label: string;
  effect?: UiActionEffect;
  operation: UiActionOperation;
  parameters?: UiActionParameterSpec;
  confirmation?: UiConfirmation;
  readiness?: UiActionReadiness;
  result?: UiActionResultSpec;
  permissions?: readonly UiPermission[];
  conditions?: readonly UiCondition[];
};

export type SurfaceRead<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function resultSpec(message: string): UiActionResultSpec {
  return {
    success: { message },
    errors: [
      { reason: "unavailable", message: "The daemon action is currently unavailable." },
      { reason: "invalid-input", message: "The action parameters did not match the declared schema." },
    ],
  };
}

export function externalUrlResultSpec(message: string): UiActionResultSpec {
  return {
    ...resultSpec(message),
    success: {
      message,
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["external-url"] },
          url: { type: "string", format: "url" },
          label: { type: "string" },
        },
        required: ["kind", "url", "label"],
        additionalProperties: false,
      },
    },
  };
}

export function action(args: ActionArgs): UiAction {
  const effect = args.effect ?? "read";
  return {
    surfaceId: args.surfaceId,
    actionId: args.actionId,
    scopeId: args.scopeId,
    label: args.label,
    effect,
    operation: args.operation,
    parameters: args.parameters,
    confirmation: args.confirmation ?? { mode: "none" },
    readiness: args.readiness ?? { state: "ready" },
    result: args.result ?? resultSpec(`${args.label} completed.`),
    conditions: args.conditions,
    permissions: args.permissions ?? [
      { kind: "effect", effect },
      { kind: "capability-scope", scope: effect === "read" ? "read" : "control" },
    ],
  };
}

export function uniqueActions(actions: readonly (UiAction | undefined)[]): UiAction[] {
  const seen = new Set<string>();
  const out: UiAction[] = [];
  for (const action of actions) {
    if (!action) continue;
    const key = `${action.surfaceId}:${action.actionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export function readRole<T>(read: SurfaceRead<T>): UiRole {
  return read.ok ? "success" : "warn";
}

export function readValue<T>(read: SurfaceRead<T>, value: (inner: T) => string): string {
  return read.ok ? value(read.value) : read.message;
}

export function shortId(value: string, max = 32): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function unavailableRows(message: string): UiTableRow[] {
  return [
    {
      id: "unavailable",
      cells: [
        { columnId: "name", value: "Unavailable", role: "warn" },
        { columnId: "state", value: message, role: "warn" },
        { columnId: "detail", value: "The active KotaClient could not read this namespace.", role: "muted" },
      ],
    },
  ];
}

export const NAME_STATE_DETAIL_COLUMNS: UiTableColumn[] = [
  { id: "name", label: "Name" },
  { id: "state", label: "State" },
  { id: "detail", label: "Detail" },
];

export function emptyRows(label: string): UiTableRow[] {
  return [
    {
      id: "none",
      cells: [
        { columnId: "name", value: label, role: "muted" },
        { columnId: "state", value: "empty", role: "muted" },
        { columnId: "detail", value: "No matching records are exposed right now.", role: "muted" },
      ],
    },
  ];
}
