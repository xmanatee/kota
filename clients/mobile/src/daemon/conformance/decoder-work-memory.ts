import { asObject, asOptionalString, asString, fail } from './decoder-common';

export type WorkMemorySourceKind =
  | "run"
  | "session"
  | "file"
  | "url"
  | "tool"
  | "manual";

export type WorkMemoryFreshnessState =
  | "current"
  | "stale"
  | "superseded"
  | "retracted";

export type WorkMemoryProvenance = {
  sourceKind: WorkMemorySourceKind;
  observedAt: string;
  sourceId?: string;
  sourcePath?: string;
  sourceUrl?: string;
  sourceTool?: string;
  note?: string;
};

export type WorkMemoryFreshness = {
  status: WorkMemoryFreshnessState;
  changedAt?: string;
  note?: string;
  replacementId?: string;
};
export function parseOptionalWorkMemoryProvenance(
  raw: unknown,
  field: string,
): WorkMemoryProvenance | undefined {
  if (raw === undefined) return undefined;
  const obj = asObject(raw, field);
  const sourceKind = asString(obj.sourceKind, `${field}.sourceKind`);
  if (
    sourceKind !== "run" &&
    sourceKind !== "session" &&
    sourceKind !== "file" &&
    sourceKind !== "url" &&
    sourceKind !== "tool" &&
    sourceKind !== "manual"
  ) {
    return fail(`unknown work-memory source kind: ${sourceKind}`);
  }
  return {
    sourceKind,
    observedAt: asString(obj.observedAt, `${field}.observedAt`),
    ...(asOptionalString(obj.sourceId, `${field}.sourceId`) !== undefined && {
      sourceId: asOptionalString(obj.sourceId, `${field}.sourceId`),
    }),
    ...(asOptionalString(obj.sourcePath, `${field}.sourcePath`) !== undefined && {
      sourcePath: asOptionalString(obj.sourcePath, `${field}.sourcePath`),
    }),
    ...(asOptionalString(obj.sourceUrl, `${field}.sourceUrl`) !== undefined && {
      sourceUrl: asOptionalString(obj.sourceUrl, `${field}.sourceUrl`),
    }),
    ...(asOptionalString(obj.sourceTool, `${field}.sourceTool`) !== undefined && {
      sourceTool: asOptionalString(obj.sourceTool, `${field}.sourceTool`),
    }),
    ...(asOptionalString(obj.note, `${field}.note`) !== undefined && {
      note: asOptionalString(obj.note, `${field}.note`),
    }),
  };
}

export function parseOptionalWorkMemoryFreshness(
  raw: unknown,
  field: string,
): WorkMemoryFreshness | undefined {
  if (raw === undefined) return undefined;
  const obj = asObject(raw, field);
  const status = asString(obj.status, `${field}.status`);
  if (
    status !== "current" &&
    status !== "stale" &&
    status !== "superseded" &&
    status !== "retracted"
  ) {
    return fail(`unknown work-memory freshness status: ${status}`);
  }
  return {
    status,
    ...(asOptionalString(obj.changedAt, `${field}.changedAt`) !== undefined && {
      changedAt: asOptionalString(obj.changedAt, `${field}.changedAt`),
    }),
    ...(asOptionalString(obj.note, `${field}.note`) !== undefined && {
      note: asOptionalString(obj.note, `${field}.note`),
    }),
    ...(asOptionalString(obj.replacementId, `${field}.replacementId`) !==
      undefined && {
      replacementId: asOptionalString(obj.replacementId, `${field}.replacementId`),
    }),
  };
}
