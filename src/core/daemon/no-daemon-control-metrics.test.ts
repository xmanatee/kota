/**
 * Import guard: refuses any reintroduction of `daemon-control-metrics*.ts`
 * under `src/core/daemon/`.
 *
 * The tracing module owns its `GET /metrics` route via
 * `KotaModule.controlRoutes` (see `src/modules/tracing/routes.ts`). A
 * regression that smuggles a core-resident handler back into this
 * directory turns this test red. The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-metrics*.ts files in src/core/daemon/", () => {
  it("the metrics route lives in #modules/tracing, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-metrics.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
