/**
 * Import guard: refuses any reintroduction of `daemon-control-approvals*.ts`
 * under `src/core/daemon/`.
 *
 * The approval-queue module owns its `/approvals*` routes via
 * `KotaModule.controlRoutes` (see `src/modules/approval-queue/routes.ts`). A
 * regression that smuggles a core-resident handler back into this directory
 * turns this test red. The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-approvals*.ts files in src/core/daemon/", () => {
  it("the approval routes live in #modules/approval-queue, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-approvals.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
