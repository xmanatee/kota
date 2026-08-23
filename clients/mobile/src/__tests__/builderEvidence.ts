import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  projectEvidenceJsonValue,
  type EvidenceJsonValue,
} from '../../../../src/core/evidence/policy';

export function writeBuilderEvidence(filename: string, value: unknown): void {
  const artifactDir = process.env.KOTA_RUN_ARTIFACT_DIR;
  if (!artifactDir) return;
  mkdirSync(artifactDir, { recursive: true });
  const serializable = JSON.parse(
    JSON.stringify(
      value,
      (key, current) => key === '_owner' ? undefined : current,
    ),
  ) as EvidenceJsonValue;
  writeFileSync(
    join(artifactDir, filename),
    `${JSON.stringify(
      projectEvidenceJsonValue(serializable, 'internal-storage'),
      null,
      2,
    )}\n`,
    'utf8',
  );
}
