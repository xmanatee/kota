import type {
  UiAction,
  UiCondition,
  UiPermission,
  UiRole,
} from '../daemon/ui-surface.generated';
import { assertNever } from './graph';

export const roleColors: Readonly<Record<UiRole, string>> = {
  neutral: '#1c1c1e',
  info: '#0a67c7',
  success: '#237a42',
  warn: '#995c00',
  error: '#b42318',
  muted: '#6c6c70',
};

export function operationLabel(action: UiAction): string {
  switch (action.operation.kind) {
    case 'daemon-route':
      return `${action.operation.method} ${action.operation.path}`;
    case 'client-namespace':
      return `${action.operation.namespace}.${action.operation.method}`;
    default:
      return assertNever(action.operation);
  }
}

export function readinessMessage(action: UiAction): string | undefined {
  switch (action.readiness.state) {
    case 'ready':
      return action.readiness.message;
    case 'disabled':
      return `${action.readiness.message} (${action.readiness.reason})`;
    case 'needs-setup':
      return `${action.readiness.message} (${action.readiness.moduleName}/${action.readiness.requirementId})`;
    default:
      return assertNever(action.readiness);
  }
}

export function conditionLabel(condition: UiCondition): string {
  switch (condition.kind) {
    case 'capability':
      return `${condition.capabilityId}: ${condition.status}`;
    case 'setup':
      return `${condition.moduleName}/${condition.requirementId}: ${condition.state}`;
    case 'scope':
      return `Scope ${condition.scopeId}`;
    default:
      return assertNever(condition);
  }
}

export function permissionLabel(permission: UiPermission): string {
  switch (permission.kind) {
    case 'capability-scope':
      return `${permission.scope} access`;
    case 'effect':
      return `${permission.effect} effect`;
    default:
      return assertNever(permission);
  }
}

export function rowActionDefaults(
  action: UiAction,
  rowId: string,
): Readonly<Record<string, string>> {
  const required = action.parameters?.schema.required ?? [];
  const idFields = required.filter((id) => /id$/i.test(id));
  return idFields.length === 1 && idFields[0]
    ? { [idFields[0]]: rowId }
    : {};
}
