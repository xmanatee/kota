/**
 * Import guard: refuses any reintroduction of `daemon-control-owner-questions*.ts`
 * under `src/core/daemon/`.
 *
 * The owner-questions module owns its `/owner-questions*` routes via
 * `KotaModule.controlRoutes` (see `src/modules/owner-questions/routes.ts`). A
 * regression that smuggles a core-resident handler back into this directory
 * turns this test red. The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-owner-questions*.ts files in src/core/daemon/", () => {
  it("the owner-question routes live in #modules/owner-questions, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-owner-questions.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
