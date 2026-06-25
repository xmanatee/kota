import type {
  ResourceDiscoveryCandidate,
  ResourceDiscoverySearchField,
} from "./catalog-types.js";
import type {
  ResourceDiscoveryKind,
  ResourceDiscoveryReadiness,
  ResourceDiscoveryRisk,
} from "./client.js";

const KIND_TAGS: Record<ResourceDiscoveryKind, string> = {
  tool: "tool action function",
  skill: "skill guidance instructions",
  agent: "agent worker specialist",
  workflow: "workflow automation trigger",
  module: "module capability integration",
  channel: "channel chat transport inbound outbound",
  "mcp-server": "mcp server config registry connector",
  "setup-requirement": "setup auth credential configuration readiness",
  "knowledge-entry": "knowledge entry reference research note",
  "recall-hit": "recall memory history task answer knowledge reference",
};

export function titleCaseKind(kind: ResourceDiscoveryKind): string {
  return kind.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function compact(values: readonly string[]): string {
  return values.filter((value) => value.trim().length > 0).join(" ");
}

export function metadata(values: ResourceMetadata): ResourceMetadata {
  return values;
}

type ResourceMetadata = Readonly<Record<string, string | number | boolean>>;

export function candidate(args: {
  kind: ResourceDiscoveryKind;
  id: string;
  name: string;
  title?: string;
  description: string;
  ownerModule: string;
  readiness: ResourceDiscoveryReadiness;
  inspectPath: string;
  accessHint: string;
  tags?: readonly string[];
  risk?: ResourceDiscoveryRisk;
  metadata?: ResourceMetadata;
  extraFields?: readonly ResourceDiscoverySearchField[];
}): ResourceDiscoveryCandidate {
  const title = args.title ?? args.name;
  const tags = args.tags ?? [];
  return {
    hit: {
      kind: args.kind,
      id: args.id,
      name: args.name,
      title,
      description: args.description,
      readiness: args.readiness,
      ownerModule: args.ownerModule,
      inspectPath: args.inspectPath,
      accessHint: args.accessHint,
      tags,
      ...(args.risk ? { risk: args.risk } : {}),
      metadata: args.metadata ?? {},
    },
    fields: [
      { label: "name", text: args.name, weight: 5 },
      { label: "title", text: title, weight: 4 },
      { label: "kind", text: `${args.kind} ${KIND_TAGS[args.kind]}`, weight: 2 },
      { label: "description", text: args.description, weight: 2 },
      { label: "owner", text: args.ownerModule, weight: 2 },
      { label: "tags", text: tags.join(" "), weight: 1 },
      ...(args.extraFields ?? []),
    ],
  };
}
