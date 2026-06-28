import type {
  AgentCanUseTool,
  AgentPermissionResult,
} from "#core/agent-harness/types.js";
import type { SDKQueryOptions } from "./sdk-types.js";

type SdkDecisionClassification = "user_temporary" | "user_permanent" | "user_reject";
type AgentToolInput = Parameters<AgentCanUseTool>[1];
type SdkCanUseTool = NonNullable<SDKQueryOptions["canUseTool"]>;
type SdkPermissionResult = Awaited<ReturnType<SdkCanUseTool>>;
type SdkAllowPermissionResult = Extract<SdkPermissionResult, { behavior: "allow" }>;
type SdkDenyPermissionResult = Extract<SdkPermissionResult, { behavior: "deny" }>;

function attributionToSdk(
  attribution: AgentPermissionResult["decisionAttribution"],
): SdkDecisionClassification | undefined {
  switch (attribution) {
    case "operator-allow-once":
      return "user_temporary";
    case "operator-allow-always":
      return "user_permanent";
    case "operator-deny":
      return "user_reject";
    case undefined:
      return undefined;
  }
}

function isObjectValue(value: object | null | undefined): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolInput(value: AgentToolInput | undefined): value is AgentToolInput {
  return isObjectValue(value);
}

export function normalizePermissionResult(
  result: AgentPermissionResult,
  input: AgentToolInput,
): AgentPermissionResult {
  if (!isObjectValue(result)) {
    throw new Error("SDK permission callback must return a permission decision object");
  }
  const behavior = result.behavior;

  if (behavior === "allow") {
    return {
      ...result,
      updatedInput: isToolInput(result.updatedInput) ? result.updatedInput : input,
    };
  }

  if (behavior === "deny") {
    if (typeof result.message !== "string" || result.message.length === 0) {
      throw new Error("SDK permission denial must include a non-empty message");
    }
    return result;
  }

  throw new Error(`Unsupported SDK permission behavior: ${String(behavior)}`);
}

function toSdkPermissionResult(
  result: AgentPermissionResult,
): SdkPermissionResult {
  const sdkAttribution = attributionToSdk(result.decisionAttribution);

  if (result.behavior === "allow") {
    const sdkResult: SdkAllowPermissionResult = {
      behavior: "allow",
      updatedInput: result.updatedInput,
    };
    if (result.updatedPermissions !== undefined) {
      sdkResult.updatedPermissions =
        result.updatedPermissions as SdkAllowPermissionResult["updatedPermissions"];
    }
    if (result.toolUseId !== undefined) sdkResult.toolUseID = result.toolUseId;
    if (sdkAttribution !== undefined) {
      sdkResult.decisionClassification = sdkAttribution;
    }
    return sdkResult;
  }

  const sdkResult: SdkDenyPermissionResult = {
    behavior: "deny",
    message: result.message,
  };
  if (result.interrupt !== undefined) sdkResult.interrupt = result.interrupt;
  if (result.toolUseId !== undefined) sdkResult.toolUseID = result.toolUseId;
  if (sdkAttribution !== undefined) {
    sdkResult.decisionClassification = sdkAttribution;
  }
  return sdkResult;
}

export function normalizeCanUseTool(
  canUseTool: AgentCanUseTool | undefined,
): SDKQueryOptions["canUseTool"] | undefined {
  if (!canUseTool) return undefined;
  const wrappedCanUseTool: SdkCanUseTool = async (toolName, input, sdkContext) => {
    const decision = await canUseTool(toolName, input, {
      signal: sdkContext.signal,
      suggestions: sdkContext.suggestions,
      blockedPath: sdkContext.blockedPath,
      decisionReason: sdkContext.decisionReason,
      title: sdkContext.title,
      displayName: sdkContext.displayName,
      description: sdkContext.description,
      toolUseId: sdkContext.toolUseID,
      agentId: sdkContext.agentID,
    });
    const normalized = normalizePermissionResult(decision, input);
    return toSdkPermissionResult(normalized);
  };
  return wrappedCanUseTool;
}
