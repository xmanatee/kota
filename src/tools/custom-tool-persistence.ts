import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../repl-session.js";

export type CustomToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  code: string;
  language: Language;
  timeoutMs: number;
};

export const MAX_CUSTOM_TOOLS = 20;
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;
export const RESERVED_NAMES = new Set([
  "shell", "file_read", "file_write", "file_edit", "multi_edit", "find_replace",
  "grep", "glob", "todo", "repo_map", "delegate", "web_fetch", "web_search",
  "ask_user", "http_request", "process", "code_exec", "notebook", "files_overview",
  "enable_tools", "custom_tool", "extension_factory", "memory", "schedule", "get_secret",
]);

export function validateName(name: string): string | null {
  if (!name) return "Error: name is required";
  if (!TOOL_NAME_RE.test(name)) {
    return `Error: name must be snake_case, 3-50 chars (lowercase letters, digits, underscores). Got: "${name}"`;
  }
  if (RESERVED_NAMES.has(name)) {
    return `Error: "${name}" conflicts with a built-in tool name`;
  }
  return null;
}

export function normalizeSchema(raw: Record<string, unknown> | undefined): Record<string, unknown> | string {
  if (!raw) {
    return { type: "object", properties: {} };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "Error: parameters must be a JSON Schema object";
  }
  if (raw.type !== "object") {
    return 'Error: parameters.type must be "object"';
  }
  if (typeof raw.properties !== "object" || raw.properties === null) {
    return "Error: parameters must have a properties field";
  }
  return raw;
}

export function getToolsDir(): string {
  return join(process.cwd(), ".kota", "tools");
}

export function getToolPath(name: string): string {
  return join(getToolsDir(), `${name}.json`);
}

export function saveToDisk(def: CustomToolDef): void {
  const dir = getToolsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    code: def.code,
    language: def.language,
  };
  writeFileSync(getToolPath(def.name), JSON.stringify(data, null, 2));
}
