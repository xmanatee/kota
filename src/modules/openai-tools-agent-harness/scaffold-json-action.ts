import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { ValidatedToolUseBlock } from "./tool-loop.js";

function toolUse(
  id: string,
  name: string,
  input: KotaJsonObject,
): ValidatedToolUseBlock {
  return { type: "tool_use", id, name, input };
}

function parsedActionInput(parsed: {
  input?: KotaJsonObject;
  args?: KotaJsonObject;
  arguments?: KotaJsonObject;
}): KotaJsonObject {
  if (parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)) {
    return parsed.input;
  }
  if (parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)) {
    return parsed.args;
  }
  if (
    parsed.arguments &&
    typeof parsed.arguments === "object" &&
    !Array.isArray(parsed.arguments)
  ) {
    return parsed.arguments;
  }
  return {};
}

export function parseScaffoldJsonAction(
  text: string,
  id: string,
): ValidatedToolUseBlock | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const name =
      typeof parsed.action === "string"
        ? parsed.action
        : typeof parsed.tool === "string"
          ? parsed.tool
          : typeof parsed.name === "string"
            ? parsed.name
            : null;
    if (!name) return null;
    return toolUse(id, name, parsedActionInput(parsed));
  } catch {
    return null;
  }
}
