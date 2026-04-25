/**
 * Import guard: refuses any reintroduction of `daemon-control-commands*.ts`
 * under `src/core/daemon/`.
 *
 * The commands module owns its `/commands` and `/commands/invoke` daemon-
 * control routes via `KotaModule.controlRoutes` (see
 * `src/modules/commands/control-routes.ts`). It triggers workflow runs
 * through the workflow-dispatcher provider seam
 * (`src/core/workflow/workflow-dispatcher-provider.ts`), so no per-module
 * handler needs to live in core. A regression that smuggles a core-resident
 * handler back into this directory turns this test red. The repo-wide
 * `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-commands*.ts files in src/core/daemon/", () => {
  it("the commands daemon-control routes live in #modules/commands, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-commands.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
