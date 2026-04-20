import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// Runs each guard in order. The first `deny` result short-circuits; otherwise
// all guards agree and we allow with the final input. If a guard returns
// `allow` with an `updatedInput`, that updated input is threaded through to
// subsequent guards so they see the rewritten form.
export function composeCanUseTools(...guards: CanUseTool[]): CanUseTool {
  return async (toolName, input, opts): Promise<PermissionResult> => {
    let currentInput = input;
    for (const guard of guards) {
      const result = await guard(toolName, currentInput, opts);
      if (result.behavior === "deny") return result;
      if (
        result.behavior === "allow" &&
        typeof result.updatedInput === "object" &&
        result.updatedInput !== null
      ) {
        currentInput = result.updatedInput as typeof input;
      }
    }
    return { behavior: "allow", updatedInput: currentInput };
  };
}
