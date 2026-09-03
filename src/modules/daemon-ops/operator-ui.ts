export type {
  UiActionExecutionPayload,
  UiActionExecutionResult,
  UiClientNamespaceExecutor,
  UiRouteExecutor,
} from "./operator-ui-actions.js";
export {
  executeScopesUiAction,
  executeUiAction,
  findUiAction,
} from "./operator-ui-actions.js";
export {
  buildContinuityProjection,
  buildContinuityUiSurface,
  buildInboxUiSurface,
  buildOperatorControlUiSurface,
  buildScopeUiSurface,
  buildStatusUiSurface,
  CONTINUITY_COMPOSED_STORES,
  type ContinuityProjection,
  type ContinuityProjectionInput,
  type ContinuityState,
  type SurfaceRead,
} from "./operator-ui-builders.js";
export { renderUiSurface } from "./operator-ui-render.js";
export type {
  UiAction,
  UiActionEffect,
  UiConfirmation,
  UiIntent,
  UiJsonValue,
  UiLinkTarget,
  UiListItem,
  UiLogEntry,
  UiLogStreamSource,
  UiNode,
  UiRole,
  UiStatusEntry,
  UiSurface,
  UiSurfaceBundle,
  UiTab,
} from "./operator-ui-types.js";
