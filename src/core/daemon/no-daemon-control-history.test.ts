/**
 * Import guard: refuses any reintroduction of `daemon-control-history*.ts`
 * under `src/core/daemon/`.
 *
 * The history module owns its `/history`, `/history/:id` routes via
 * `KotaModule.controlRoutes` (see `src/modules/history/routes.ts`). A
 * regression that smuggles a core-resident handler back into this
 * directory turns this test red. The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-history*.ts files in src/core/daemon/", () => {
  it("the history routes live in #modules/history, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-history.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
