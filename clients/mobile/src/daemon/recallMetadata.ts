export type WorkMemorySourceKind =
  | 'run'
  | 'session'
  | 'file'
  | 'url'
  | 'tool'
  | 'manual';

export type WorkMemoryFreshnessState =
  | 'current'
  | 'stale'
  | 'superseded'
  | 'retracted';

export interface WorkMemoryProvenance {
  sourceKind: WorkMemorySourceKind;
  observedAt: string;
  sourceId?: string;
  sourcePath?: string;
  sourceUrl?: string;
  sourceTool?: string;
  note?: string;
}

export interface WorkMemoryFreshness {
  status: WorkMemoryFreshnessState;
  changedAt?: string;
  note?: string;
  replacementId?: string;
}

export function parseOptionalRecallMetadata(obj: Record<string, unknown>): {
  provenance?: WorkMemoryProvenance;
  freshness?: WorkMemoryFreshness;
} {
  const provenance = parseOptionalWorkMemoryProvenance(obj.provenance);
  const freshness = parseOptionalWorkMemoryFreshness(obj.freshness);
  return {
    ...(provenance && { provenance }),
    ...(freshness && { freshness }),
  };
}

function parseOptionalWorkMemoryProvenance(
  value: unknown,
): WorkMemoryProvenance | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recall metadata: provenance must be an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    obj.sourceKind !== 'run' &&
    obj.sourceKind !== 'session' &&
    obj.sourceKind !== 'file' &&
    obj.sourceKind !== 'url' &&
    obj.sourceKind !== 'tool' &&
    obj.sourceKind !== 'manual'
  ) {
    throw new Error(
      `Invalid recall metadata: unknown source kind ${String(obj.sourceKind)}`,
    );
  }
  if (typeof obj.observedAt !== 'string') {
    throw new Error('Invalid recall metadata: provenance observedAt missing');
  }
  return {
    sourceKind: obj.sourceKind,
    observedAt: obj.observedAt,
    ...(typeof obj.sourceId === 'string' && { sourceId: obj.sourceId }),
    ...(typeof obj.sourcePath === 'string' && { sourcePath: obj.sourcePath }),
    ...(typeof obj.sourceUrl === 'string' && { sourceUrl: obj.sourceUrl }),
    ...(typeof obj.sourceTool === 'string' && { sourceTool: obj.sourceTool }),
    ...(typeof obj.note === 'string' && { note: obj.note }),
  };
}

function parseOptionalWorkMemoryFreshness(
  value: unknown,
): WorkMemoryFreshness | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recall metadata: freshness must be an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    obj.status !== 'current' &&
    obj.status !== 'stale' &&
    obj.status !== 'superseded' &&
    obj.status !== 'retracted'
  ) {
    throw new Error(
      `Invalid recall metadata: unknown freshness status ${String(obj.status)}`,
    );
  }
  return {
    status: obj.status,
    ...(typeof obj.changedAt === 'string' && { changedAt: obj.changedAt }),
    ...(typeof obj.note === 'string' && { note: obj.note }),
    ...(typeof obj.replacementId === 'string' && {
      replacementId: obj.replacementId,
    }),
  };
}
