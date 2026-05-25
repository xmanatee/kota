import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaMcpResourceContents,
} from "#core/agent-harness/message-protocol.js";
import {
  isJsonObject,
} from "./client-decode-utils.js";
import type {
  McpCacheHints,
  McpInputRequiredResult,
  McpProtocolVersion,
  McpReadResourceCompleteResult,
  McpReadResourceResult,
} from "./client-protocol.js";

export const MCP_SKILL_INDEX_RESOURCE_URI = "skill://index.json";
export const AGENT_SKILLS_DISCOVERY_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const MAX_REMOTE_SKILL_CONTENT_CHARS = 100_000;

export type McpRemoteSkillSource = "enumerated" | "direct";

export type McpRemoteSkillMdEntry = {
  type: "skill-md";
  name: string;
  description: string;
  uri: string;
  source: "enumerated";
};

export type McpRemoteSkillTemplateEntry = {
  type: "mcp-resource-template";
  description: string;
  uriTemplate: string;
  source: "enumerated";
};

export type McpRemoteSkillCatalogEntry =
  | McpRemoteSkillMdEntry
  | McpRemoteSkillTemplateEntry;

export type McpRemoteSkillCatalog =
  | {
      status: "enumerated";
      indexUri: typeof MCP_SKILL_INDEX_RESOURCE_URI;
      enumerationExhaustive: false;
      advertised: boolean;
      skills: McpRemoteSkillCatalogEntry[];
      cache: McpCacheHints;
    }
  | {
      status: "unavailable";
      indexUri: typeof MCP_SKILL_INDEX_RESOURCE_URI;
      enumerationExhaustive: false;
      advertised: boolean;
      skills: [];
      reason: string;
    };

export type McpBoundedRemoteSkillTextContent = {
  uri: string;
  text: string;
  textTruncated: boolean;
  originalTextLength: number;
  mimeType?: string;
  _meta?: KotaJsonObject;
};

export type McpBoundedRemoteSkillBlobContent = {
  uri: string;
  blob: string;
  blobTruncated: boolean;
  originalBlobLength: number;
  mimeType?: string;
  _meta?: KotaJsonObject;
};

export type McpBoundedRemoteSkillContent =
  | McpBoundedRemoteSkillTextContent
  | McpBoundedRemoteSkillBlobContent;

export type McpRemoteSkillReadCompleteResult = {
  resultType: "complete";
  protocolVersion: McpProtocolVersion;
  provenance: {
    server: string;
    uri: string;
    source: McpRemoteSkillSource;
    untrusted: true;
  };
  contents: McpBoundedRemoteSkillContent[];
  cache: McpCacheHints;
  _meta?: KotaJsonObject;
};

export type McpRemoteSkillReadResult =
  | McpRemoteSkillReadCompleteResult
  | McpInputRequiredResult;

type ParsedSkillUri =
  | { kind: "index" }
  | {
      kind: "resource";
      segments: string[];
      isSkillMarkdown: boolean;
      skillName?: string;
    };

const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function malformedSkillIndex(serverName: string, label: string, expected: string): Error {
  return new Error(
    `Malformed MCP skill index from server "${serverName}": ${label} must be ${expected}`,
  );
}

function malformedSkillUri(label: string, reason: string): Error {
  return new Error(`Invalid MCP skill resource URI for ${label}: ${reason}`);
}

function requiredIndexString(
  object: KotaJsonObject,
  key: string,
  label: string,
  serverName: string,
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw malformedSkillIndex(serverName, label, "a non-empty string");
  }
  return value;
}

function validateSkillName(name: string, label: string): void {
  if (!SKILL_NAME_RE.test(name) || name.includes("--")) {
    throw malformedSkillUri(
      label,
      "skill names must use 1-64 lowercase letters, digits, and single hyphens",
    );
  }
}

function decodeUriSegment(segment: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw malformedSkillUri(label, "path segments must be valid percent-encoding");
  }
  if (
    decoded.length === 0 ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\")
  ) {
    throw malformedSkillUri(label, "path segments must not be empty or traverse directories");
  }
  return decoded;
}

function parseSkillUri(uri: string, label: string): ParsedSkillUri {
  if (!uri.startsWith("skill://")) {
    throw malformedSkillUri(label, 'URI must use the "skill://" scheme');
  }
  if (uri.includes("{") || uri.includes("}")) {
    throw malformedSkillUri(label, "URI templates must be resolved before reading");
  }
  const rest = uri.slice("skill://".length);
  if (rest === MCP_SKILL_INDEX_RESOURCE_URI.slice("skill://".length)) {
    return { kind: "index" };
  }
  if (rest.length === 0) {
    throw malformedSkillUri(label, "URI must include a skill path");
  }
  const segments = rest.split("/").map((segment) => decodeUriSegment(segment, label));
  const skillMarkdownPositions = segments
    .map((segment, index) => segment === "SKILL.md" ? index : -1)
    .filter((index) => index !== -1);
  if (skillMarkdownPositions.length > 1) {
    throw malformedSkillUri(label, "SKILL.md may appear only once");
  }
  if (
    skillMarkdownPositions.length === 1 &&
    skillMarkdownPositions[0] !== segments.length - 1
  ) {
    throw malformedSkillUri(label, "SKILL.md may appear only as the final segment");
  }
  if (segments[segments.length - 1] === "SKILL.md") {
    if (segments.length < 2) {
      throw malformedSkillUri(label, "SKILL.md must be inside a skill directory");
    }
    const skillName = segments[segments.length - 2];
    validateSkillName(skillName, label);
    return { kind: "resource", segments, isSkillMarkdown: true, skillName };
  }
  return { kind: "resource", segments, isSkillMarkdown: false };
}

export function assertValidRemoteSkillResourceUri(uri: string, label = "uri"): void {
  const parsed = parseSkillUri(uri, label);
  if (parsed.kind === "index") {
    throw malformedSkillUri(label, "skill://index.json is a catalog, not a skill");
  }
}

export function assertValidRemoteSkillMarkdownUri(uri: string, label = "uri"): string {
  const parsed = parseSkillUri(uri, label);
  if (parsed.kind === "index" || !parsed.isSkillMarkdown || parsed.skillName === undefined) {
    throw malformedSkillUri(label, "skill reads by name must resolve to SKILL.md");
  }
  return parsed.skillName;
}

function validateTemplateUri(uriTemplate: string, label: string): void {
  if (!uriTemplate.includes("{") || !uriTemplate.includes("}")) {
    throw malformedSkillUri(label, "mcp-resource-template URLs must contain URI template variables");
  }
  if (!uriTemplate.endsWith("/SKILL.md")) {
    throw malformedSkillUri(label, "mcp-resource-template URLs must resolve to SKILL.md");
  }
  if (uriTemplate.includes("..")) {
    throw malformedSkillUri(label, "URI templates must not contain path traversal");
  }
}

function validateRelativeSkillPath(relativePath: string): string[] {
  if (relativePath.length === 0 || relativePath.startsWith("/")) {
    throw malformedSkillUri("relativePath", "relative paths must be non-empty and relative");
  }
  const segments = relativePath
    .split("/")
    .map((segment) => decodeUriSegment(segment, "relativePath"));
  const skillMarkdownPositions = segments
    .map((segment, index) => segment === "SKILL.md" ? index : -1)
    .filter((index) => index !== -1);
  if (
    skillMarkdownPositions.length > 1 ||
    (skillMarkdownPositions.length === 1 && segments.length !== 1)
  ) {
    throw malformedSkillUri(
      "relativePath",
      "relative paths must not address nested SKILL.md files",
    );
  }
  return segments;
}

export function resolveRemoteSkillRelativeUri(
  baseSkillUri: string,
  relativePath: string,
): string {
  assertValidRemoteSkillMarkdownUri(baseSkillUri, "baseUri");
  const segments = validateRelativeSkillPath(relativePath);
  const rootUri = baseSkillUri.slice(0, baseSkillUri.length - "SKILL.md".length);
  return `${rootUri}${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function indexText(result: McpReadResourceCompleteResult, serverName: string): string {
  const textContents = result.contents.filter((content) => "text" in content);
  if (textContents.length !== 1) {
    throw malformedSkillIndex(serverName, "contents", "exactly one text resource");
  }
  return textContents[0].text;
}

function decodeSkillIndexEntry(
  value: KotaJsonValue,
  index: number,
  serverName: string,
  seenNames: Set<string>,
): McpRemoteSkillCatalogEntry {
  const label = `skills[${index}]`;
  if (!isJsonObject(value)) {
    throw malformedSkillIndex(serverName, label, "an object");
  }
  const type = requiredIndexString(value, "type", `${label}.type`, serverName);
  const description = requiredIndexString(
    value,
    "description",
    `${label}.description`,
    serverName,
  );
  const url = requiredIndexString(value, "url", `${label}.url`, serverName);
  if (type === "skill-md") {
    const name = requiredIndexString(value, "name", `${label}.name`, serverName);
    validateSkillName(name, `${label}.name`);
    if (seenNames.has(name)) {
      throw new Error(
        `Malformed MCP skill index from server "${serverName}": duplicate skill name "${name}"`,
      );
    }
    seenNames.add(name);
    const uriName = assertValidRemoteSkillMarkdownUri(url, `${label}.url`);
    if (uriName !== name) {
      throw new Error(
        `Malformed MCP skill index from server "${serverName}": ${label}.url skill name "${uriName}" must match name "${name}"`,
      );
    }
    return {
      type,
      name,
      description,
      uri: url,
      source: "enumerated",
    };
  }
  if (type === "mcp-resource-template") {
    if (value.name !== undefined) {
      throw malformedSkillIndex(serverName, `${label}.name`, "omitted for mcp-resource-template");
    }
    validateTemplateUri(url, `${label}.url`);
    return {
      type,
      description,
      uriTemplate: url,
      source: "enumerated",
    };
  }
  throw new Error(
    `Malformed MCP skill index from server "${serverName}": ${label}.type must be skill-md or mcp-resource-template`,
  );
}

export function decodeRemoteSkillIndexResource(
  result: McpReadResourceCompleteResult,
  serverName: string,
  advertised: boolean,
): McpRemoteSkillCatalog {
  const rawIndexText = indexText(result, serverName);
  let parsed: KotaJsonValue;
  try {
    parsed = JSON.parse(rawIndexText) as KotaJsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Malformed MCP skill index from server "${serverName}": JSON parse failed: ${message}`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw malformedSkillIndex(serverName, "index", "an object");
  }
  const schema = requiredIndexString(parsed, "$schema", "$schema", serverName);
  if (schema !== AGENT_SKILLS_DISCOVERY_SCHEMA) {
    throw new Error(
      `Malformed MCP skill index from server "${serverName}": $schema must be ${AGENT_SKILLS_DISCOVERY_SCHEMA}`,
    );
  }
  if (!Array.isArray(parsed.skills)) {
    throw malformedSkillIndex(serverName, "skills", "an array");
  }
  const seenNames = new Set<string>();
  return {
    status: "enumerated",
    indexUri: MCP_SKILL_INDEX_RESOURCE_URI,
    enumerationExhaustive: false,
    advertised,
    skills: parsed.skills.map((entry, index) =>
      decodeSkillIndexEntry(entry, index, serverName, seenNames)
    ),
    cache: result.cache,
  };
}

export function unavailableRemoteSkillCatalog(
  reason: string,
  advertised: boolean,
): McpRemoteSkillCatalog {
  return {
    status: "unavailable",
    indexUri: MCP_SKILL_INDEX_RESOURCE_URI,
    enumerationExhaustive: false,
    advertised,
    skills: [],
    reason,
  };
}

function boundTextContent(
  content: Extract<KotaMcpResourceContents, { text: string }>,
): McpBoundedRemoteSkillTextContent {
  const textTruncated = content.text.length > MAX_REMOTE_SKILL_CONTENT_CHARS;
  return {
    uri: content.uri,
    text: textTruncated
      ? content.text.slice(0, MAX_REMOTE_SKILL_CONTENT_CHARS)
      : content.text,
    textTruncated,
    originalTextLength: content.text.length,
    ...(content.mimeType !== undefined ? { mimeType: content.mimeType } : {}),
    ...(content._meta !== undefined ? { _meta: content._meta } : {}),
  };
}

function boundBlobContent(
  content: Extract<KotaMcpResourceContents, { blob: string }>,
): McpBoundedRemoteSkillBlobContent {
  const blobTruncated = content.blob.length > MAX_REMOTE_SKILL_CONTENT_CHARS;
  return {
    uri: content.uri,
    blob: blobTruncated
      ? content.blob.slice(0, MAX_REMOTE_SKILL_CONTENT_CHARS)
      : content.blob,
    blobTruncated,
    originalBlobLength: content.blob.length,
    ...(content.mimeType !== undefined ? { mimeType: content.mimeType } : {}),
    ...(content._meta !== undefined ? { _meta: content._meta } : {}),
  };
}

function boundRemoteSkillContent(
  content: KotaMcpResourceContents,
): McpBoundedRemoteSkillContent {
  if ("text" in content) return boundTextContent(content);
  return boundBlobContent(content);
}

export function toRemoteSkillReadResult(
  result: McpReadResourceResult,
  serverName: string,
  uri: string,
  source: McpRemoteSkillSource,
): McpRemoteSkillReadResult {
  if (result.resultType === "input_required") return result;
  return {
    resultType: "complete",
    protocolVersion: result.protocolVersion,
    provenance: {
      server: serverName,
      uri,
      source,
      untrusted: true,
    },
    contents: result.contents.map(boundRemoteSkillContent),
    cache: result.cache,
    ...(result._meta !== undefined ? { _meta: result._meta } : {}),
  };
}
