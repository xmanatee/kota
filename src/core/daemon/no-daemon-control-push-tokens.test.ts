/**
 * Import guard: refuses any reintroduction of `daemon-control-push-tokens*.ts`
 * or `push-tokens.ts` under `src/core/daemon/`.
 *
 * The push-notification module owns the `POST /push-tokens` route, the
 * `<projectDir>/.kota/push-tokens.json` store, the Expo Push API delivery,
 * and the `approval.requested` bus subscription via
 * `KotaModule.controlRoutes` and `onLoad` (see
 * `src/modules/push-notification/`). A regression that smuggles a core-
 * resident handler or store back into this directory turns this test red.
 * The repo-wide `#modules/*` import guard
 * (`src/core/agent-harness/no-module-imports-in-core.test.ts`) covers the
 * inverse direction; this guard covers the file-name pattern.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DAEMON_DIR = import.meta.dirname;

describe("no daemon-control-push-tokens*.ts or push-tokens.ts files in src/core/daemon/", () => {
  it("the push-token surface lives in #modules/push-notification, not core", () => {
    const offenders = readdirSync(DAEMON_DIR).filter(
      (name) =>
        /^daemon-control-push-tokens.*\.ts$/.test(name) ||
        /^push-tokens\.ts$/.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
