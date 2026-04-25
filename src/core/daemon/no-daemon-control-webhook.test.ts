/**
 * Import guard: refuses any reintroduction of `daemon-control-webhook*.ts`
 * under `src/core/daemon/`.
 *
 * The webhook module owns the signature-validated `/webhooks/:name`
 * control route via `KotaModule.controlRoutes` (see
 * `src/modules/webhook/trigger-route.ts`). A regression that smuggles a
 * core-resident handler back into this directory turns this test red.
 * The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-webhook*.ts files in src/core/daemon/", () => {
  it("the webhook trigger route lives in #modules/webhook, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter((name) =>
      /^daemon-control-webhook.*\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
